// MCP roster gate (DR-060 rule 3, first slice) — docs/agent/mcp-roster.json says
// which lane or first-party skill may call which MCP server, and for what; this
// gate checks that the DOCUMENT is internally honest, not that a call obeys it.
//
//   node scripts/check-mcp-roster.mjs              # the gate
//   node scripts/check-mcp-roster.mjs --self-test  # prove it can fail
//
// WHAT THIS CHECKS (a document, never a call):
//   - `docs/agent/mcp-roster.json` parses and has `servers`/`grants`, and
//     `grants.lanes` is an object carrying `cloud`/`mac` arrays and `grants.skills`
//     is an object — a missing or non-object required map is a FAIL, never a
//     silent `?? {}` fallback that would count a lost document as "0 grants, PASS".
//   - `signalgrid-mcp`'s `tools`/`toolNames` in the roster are DERIVED from
//     `artifacts/mcp-server/src/index.ts`'s own `server.registerTool("name", ...)`
//     calls, in source order — never hand-typed and left to drift. The
//     derivation itself is cross-checked against a plain `registerTool(` count,
//     so a registration written in a shape the derivation doesn't recognize
//     (single line, single-quoted name, ...) fails the gate instead of just
//     vanishing from the count. `toolNames` is compared to the derived list as
//     an ORDERED ARRAY (same length, same element at each position), so a
//     duplicate entry fails even though it changes neither the missing nor the
//     extra set.
//   - Every server id named in `grants.lanes.*` or `grants.skills.*` exists in
//     `servers[]` or `external[]`, and every lane/skill grant and every
//     `grants.mentions` entry carries a non-empty `for`/`why`; every lane grant
//     also carries a non-empty `source`.
//   - Every `grants.skills` key is a real FIRST-PARTY skill directory (the same
//     `.claude/skills/VENDORED.md` carve-out `scripts/lib/skill-plane.mjs` uses
//     elsewhere; a vendored skill is out of scope, same exemption every other
//     doc gate gives it).
//   - A grant is allowed only when its target is an `external[]` entry, or a
//     `servers[]` entry whose `disposition` is exactly `"adopted"` or
//     `"adopted-by-reference"` — any other disposition (a misspelling, an
//     unknown value, `evaluated-not-adopted`, `deferred`) FAILS, naming the
//     value.
//   - Every first-party skill doc naming a server — either an `mcp__<server>__`
//     tool call, or the roster's own id (or one of its optional `aliases`) as a
//     whole word, case-insensitively — must have EITHER a `grants.skills` entry
//     for that server, or a `grants.mentions[skill]` entry naming it as
//     precedent/context rather than a call. An unaccounted-for name is a FAIL
//     naming the file, the server and the missing grant/mention.
//   - Every copy of the Context7 pin equals the version in
//     `scripts/install-context7.mjs`'s `export const PINNED`, read from its
//     SOURCE by regex (importing it would run `claude mcp add`). The copies are
//     DERIVED: every tracked text file is swept for the package spec and for a
//     `Context7 … x.y.z` phrase; only the dated records in CONTEXT7_PIN_HISTORY
//     are exempt. A stale copy FAILS naming file:line; a known copy site whose
//     copy vanished FAILS too. Pin-vs-published needs the network: not here.
//
// Fail-closed: an unparseable roster, or one missing `servers`/`grants`, is
// itself a finding — a broken roster is silence dressed as a green gate.
import { readFileSync, readlinkSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { firstPartySkillDirsIn, SKILLS_DIR, VENDORED_DOC } from "./lib/skill-plane.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROSTER_PATH = "docs/agent/mcp-roster.json";
const INDEX_PATH = "artifacts/mcp-server/src/index.ts";

/** Pure: ordered tool names from `server.registerTool(\n  "name"` calls in the source. */
export function deriveToolNames(indexSource) {
  const out = [];
  const re = /server\.registerTool\(\s*\n\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(indexSource))) out.push(m[1]);
  return out;
}

// Context7 pin parity (BUILD_BACKLOG "Context7 pin staleness", offline half).
// `scripts/install-context7.mjs` owns the pin; it is read from that file's
// SOURCE by regex — never imported, because importing it runs `claude mcp add`
// at module load. Two layers:
//   1. A DERIVED sweep of every tracked text file: each `@upstash/context7-mcp@<v>`
//      package spec, and each `Context7 … <x.y.z>` phrase (case-insensitive, same
//      line, ≤40 chars apart), must name PINNED. Nothing is typed in a list, so a
//      new copy anywhere — a skill doc, .mcp.json, a new doc — is held on arrival.
//      A spec's WHOLE token after `@` must equal PINNED: a tag (@latest), range
//      (@^4.1.1, @~, @>=), wildcard (@*, @4.1.x), partial (@4, @4.0) or prerelease
//      is a finding, and `npx … @upstash/context7-mcp` with no version is too.
//      Binary and large files are swept as latin1, never skipped. The PHRASE half
//      is a heuristic over wording: a version written BEFORE the word, on the next
//      line, >40 chars away, two-component, or under another name ("ctx7") is not
//      seen; an unrelated x.y.z close after "Context7" fails (closed). A bare spec
//      with no `@version` is a finding on a package-runner line (PACKAGE_RUNNER_RE)
//      or as a JSON/YAML key; a git or URL install source is always a finding. A
//      bare spec split across lines (`"args": ["-y",` ⏎ `"@upstash/…"]`) is not seen.
//      The only exemptions are CONTEXT7_PIN_HISTORY: dated, append-only records of
//      what was true on a day, vendored upstream trees (third_party/ — their
//      configs are upstream's, not our pin), and this gate, whose fixtures plant
//      stale pins.
//   2. The known copy sites below must STILL carry a copy: a site whose copy was
//      reworded out of the sweep's shapes is a finding, not a pass. The roster's
//      `packageVersion` has no "context7" on its line, so it is held structurally.
export const CONTEXT7_INSTALLER = "scripts/install-context7.mjs";
// Known-site presence reads the token loosely; the SWEEP below is an allowlist.
const CONTEXT7_SPEC_RE = /@upstash\\?\/context7-mcp@([^\s`"'(),;\]]+)/g;
const specToken = (raw) => raw.replace(/[.:!?]+$/, "");
// A .json file is first PARSED (JSON.parse) and walked (context7JsonFindings): keys, values and command/args
// context come from the data. Only unparseable JSON (JSONC) falls back to the line reader below. A YAML value
// that IS a spec and continues onto a more-indented line is REFUSED (yamlSpecContinuations): no YAML parser is
// a dependency here, so a shape this gate cannot fold fails closed instead of passing.
// Each line is TOKENIZED the way its reader would see it, then every token
// naming the package must carry exactly PINNED. No terminator characters:
//   * shell/prose (default): POSIX words — '…' literal, "…" with \-escapes,
//     \x escaped, quotes glued to text concatenate (`@4.1.1' || 5'` is ONE word
//     `…@4.1.1 || 5`). A backtick ends a word (markdown code). An unbalanced
//     quote is a literal character (prose apostrophes).
//   * .json: each string literal is decoded. An array element is ONE argv word;
//     a value that is itself a spec (`npm:@upstash/…@x`) is one word; any other
//     value is a command string, shell-split.
//   * .yml/.yaml: a sequence item `- x` is ONE argv word; `key: value` is
//     shell-split (a `run:` command), a flow list `[a, b]` is one word per item.
// A key naming the package (`"@upstash/context7-mcp": "<v>"`, YAML
// `@upstash/context7-mcp: <v>`) takes its WHOLE value. A word's value is shed
// of trailing markup only: `**`, a markdown link `](…)`, closing HTML tags, and
// trailing ) ] } > . , ; : ! ?.
const CONTEXT7_NAME_RE = /@upstash\/context7-mcp(?![\w-])/gi; // units are decoded: a JSON `\/` is already `/`
const PACKAGE_RUNNER_RE =
  /\b(?:npx|pnpx|bunx|uvx|dlx|bun\s+(?:x|add|i|install)|npm\s+(?:exec|x|i|install|add)|pnpm\s+(?:add|i|install|exec|dlx)|yarn\s+(?:add|dlx|global\s+add)|deno\s+(?:run|install))\b/i; // Windows runners are case-insensitive: `NPX`, `Npx.CMD`
// Installing Context7 from git or a URL bypasses the npm pin entirely.
const CONTEXT7_GIT_SOURCE_RE =
  /(?:github:|gitlab:|bitbucket:|git\+[a-z]+:\/\/|git:\/\/|git@github\.com:)[^\s"'`]*upstash\/context7|codeload\.github\.com\/upstash\/context7|github\.com\/upstash\/context7(?:\.git\b|\/tarball\/|\/archive\/)/i;
const CONTEXT7_SHORTHAND_RE = /(?:^|[\s"'=])upstash\/context7(?:-mcp)?(?:#\S*)?(?=$|[\s"'])/;

/** Pure: POSIX-ish shell words of `s` (quotes concatenate; an unbalanced quote is literal; a backtick splits). */
export function shellWords(s) {
  const words = [];
  let cur = "";
  let open = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (/\s/.test(c) || c === "`" || /[;&|<>]/.test(c)) {
      // whitespace, a backtick (markdown code) and an unquoted shell operator (; & | < >) all end a word
      if (open) words.push(cur);
      cur = "";
      open = false;
    } else if (c === "'" && s.indexOf("'", i + 1) > i && !(/\w/.test(s[i - 1] ?? "") && /\w/.test(s[i + 1] ?? ""))) {
      // (an apostrophe between two letters — `cloud's` — is prose, not a shell quote)
      const close = s.indexOf("'", i + 1);
      cur += s.slice(i + 1, close);
      i = close;
      open = true;
    } else if (c === '"' && /^"(?:\\.|[^"\\])*"/.test(s.slice(i))) {
      const lit = /^"((?:\\.|[^"\\])*)"/.exec(s.slice(i));
      cur += lit[1].replace(/\\(.)/g, "$1");
      i += lit[0].length - 1;
      open = true;
    } else if (c === "\\" && i + 1 < s.length) {
      cur += s[++i];
      open = true;
    } else {
      cur += c;
      open = true;
    }
  }
  if (open) words.push(cur);
  return words;
}

// Markup is shed until stable, so `**…@4.1.1**.` and `…@4.1.1|` (a table cell) read as the pin.
const shedMarkup = (v) => {
  for (let prev = null; prev !== v; ) {
    prev = v;
    v = v
      .replace(/(?:<\/[a-z][^>]*>)+$/i, "")
      .replace(/\]\([^)]*\)$/, "")
      .replace(/\*\*$/, "")
      .replace(/[)\]}>.,;:!?|]+$/, "");
  }
  return v;
};
// A value that IS a spec (`npm:@upstash/…@x`, `@upstash/…@x`) is one argv unit, never shell-split.
const SPEC_VALUE_RE = /^(?:npm:)?@upstash\\?\/context7-mcp/i;

/** Pure: the argv-like units of `line` for a file kind ("json" | "yaml" | "shell"), each a candidate install argument. */
/** Pure: `s` with a YAML ` # comment` removed — only outside quotes. */
function stripYamlComment(s) {
  let q = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === "\\" && q === '"') i++;
      else if (c === q) q = "";
    } else if (c === '"' || c === "'") q = c;
    else if (c === "#" && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s;
}
// a YAML double-quoted scalar: JSON escapes where they parse; otherwise YAML's own (`\x` is `x`), so a non-JSON escape
// never throws the gate. An escaped line break never reaches here: logicalLines has already spliced it.
const unquoteDq = (v) => {
  try {
    return JSON.parse(v);
  } catch {
    return v.slice(1, -1).replace(/\\(.)/g, "$1"); // an escaped line break was already joined by logicalLines
  }
};
const unquote = (v) => (/^"(?:\\.|[^"\\])*"$/s.test(v) ? unquoteDq(v) : /^'.*'$/.test(v) ? v.slice(1, -1).replace(/''/g, "'") : v);
// YAML anchors (&a), aliases (*a) and tags (!!str, !t) before a value are not part of it
const stripYamlProps = (v) => v.replace(/^(?:(?:[&*][^\s,{}[\]]+|!\S*)(?:\s+|$))+/, "");

/** Pure: the values of `@upstash/context7-mcp[@selector]` KEYS on a line (dependency and override keys), each to be held to PINNED. */
// A key naming the package: the package itself, an override selector (`@x/y@4`), or a path-style
// override/resolution key whose LAST segment is the package (pnpm `parent>pkg`, yarn `**/pkg`, `parent/pkg`).
export const CONTEXT7_KEY_RE = /(?:^|[>/])@upstash\/context7-mcp(?:@\S*)?$/i;

function context7KeyValues(line, kind) {
  const out = [];
  if (kind === "json") {
    for (const m of line.matchAll(/"((?:\\.|[^"\\])*)"\s*:\s*("(?:\\.|[^"\\])*"|[^,}\]\s{["]+)?/g)) {
      let key;
      try {
        key = JSON.parse(`"${m[1]}"`);
      } catch {
        key = m[1];
      }
      if (CONTEXT7_KEY_RE.test(key)) out.push(m[2] === undefined ? "" : unquote(m[2]));
    }
    return out;
  }
  if (kind === "yaml") return out; // YAML keys are read by context7YamlKeyScan, with multi-line context
  // a quoted key (any kind, path-style allowed) or a bare one; an override key may carry a selector
  const re = /(?:(["'])(?:[^"'\s]*[>/])?@upstash\\?\/context7-mcp(?:@[^\s"':=,]*)?\1|(?:^|[\s{,?-])@upstash\\?\/context7-mcp(?:@[^\s"':=,]*)?)\s*[:=]\s*(.*)$/i;
  const m = re.exec(line);
  if (m && !/^\/\//.test(m[2])) {
    let v = stripYamlProps(stripYamlComment(m[2]).trim());
    const q = /^("(?:\\.|[^"\\])*"|'(?:[^']|'')*')/.exec(v);
    v = q ? unquote(q[1]) : v.replace(/[\s,}\]]+$/, "").trim();
    out.push(v);
  }
  return out;
}

/** Pure: a YAML value as units — a spec value is ONE word, a flow mapping/list one word per entry, else shell-split. */
function yamlValueUnits(raw) {
  const v = stripYamlProps(stripYamlComment(raw).trim());
  if (v.startsWith("{") || v.startsWith("[")) {
    return v
      .replace(/^[{[]|[}\]]$/g, "")
      .split(/,(?=(?:[^"']|"[^"]*"|'[^']*')*$)/)
      .map((e) => unquote(stripYamlProps(e.replace(/^\s*(?:"[^"]*"|'[^']*'|[^:"']+):\s+/, "").trim())));
  }
  const u = unquote(v);
  return SPEC_VALUE_RE.test(u) ? [u] : shellWords(v);
}

function lineUnits(line, kind) {
  if (kind === "json") {
    const units = [];
    for (const m of line.matchAll(/"((?:\\.|[^"\\])*)"/g)) {
      let v;
      try {
        v = JSON.parse(m[0]);
      } catch {
        v = m[1];
      }
      const before = line.slice(0, m.index).trimEnd();
      const after = line.slice(m.index + m[0].length).trimStart();
      if (after.startsWith(":")) continue; // a key; dependency keys are handled by context7KeyValues
      const isValue = before.endsWith(":");
      if (!isValue || SPEC_VALUE_RE.test(v)) units.push(v);
      else units.push(...shellWords(v));
    }
    return units;
  }
  if (kind === "yaml") {
    const bare = stripYamlProps(stripYamlComment(line).trim());
    if (SPEC_VALUE_RE.test(unquote(bare))) return [unquote(bare)]; // a continuation or bare item that IS a spec
    const item = /^\s*-\s+(?!(?:"[^"]*"|'[^']*'|[^"'#:])*:\s)(.*)$/.exec(line);
    if (item) return [unquote(stripYamlProps(stripYamlComment(item[1]).trim()))];
    const kv = /^\s*(?:-\s+)?(?:"(?:\\.|[^"\\])*"|'(?:[^']|'')*'|[^\s#"'][^#]*?)?\s*:\s+(.*)$/.exec(line); // incl. an explicit `: value`
    if (kv) return yamlValueUnits(kv[1]);
  }
  return shellWords(line);
}

/**
 * Pure: physical lines joined into LOGICAL lines, each `{ i, text }` with `i` its first line.
 * YAML: a block scalar (`key: >-` / `|`), an unclosed quote, or a more-indented plain-scalar continuation
 * is joined to its key line, as a YAML reader would fold it. Shell/prose: a line whose quote is left open
 * after the package name is joined to the next line (comment markers stripped). JSON strings cannot span lines.
 */
export function logicalLines(lines, kind, path = "") {
  const out = [];
  const indent = (l) => /^\s*/.exec(l)[0].length;
  const openQuote = (t) => {
    let q = "";
    for (let k = 0; k < t.length; k++) {
      const c = t[k];
      if (q) {
        if (c === "\\" && q === '"') k++;
        else if (c === q) q = "";
      } else if ((c === '"' || c === "'") && !(c === "'" && /\w/.test(t[k - 1] ?? "") && /\w/.test(t[k + 1] ?? ""))) q = c;
    }
    return q !== "";
  };
  if (kind === "yaml") {
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const t = stripYamlComment(l);
      const isEntry = /^\s*(?:-(?:\s|$)|#|\?\s|:\s|(?:"[^"]*"|'[^']*'|[^\s#"'][^#]*?):(?:\s|$))/.test(l);
      if (
        cur &&
        l.trim() !== "" &&
        indent(l) > cur.indent &&
        (cur.block ||
          openQuote(cur.text) ||
          // a literal `|` block's lines stay separate (each is a command); only plain scalars continue
          (!isEntry && /(?::\s+\S|^\s*-\s+\S)/.test(cur.text) && !/:\s+(?:[&!]\S+\s+)*\|[+-]?\d*\s*$/.test(cur.text)))
      ) {
        if (cur.block === "pending") {
          cur.text = cur.text.replace(/\s*[>|][+-]?\d*\s*$/, "");
          cur.block = true;
        }
        // inside a double-quoted scalar an escaped line break vanishes with the next line's indent (YAML 1.2 §7.3.1)
        if (openQuote(cur.text) && /(?<!\\)(?:\\\\)*\\$/.test(cur.text) && /"[^"]*$/.test(cur.text)) cur.text = cur.text.slice(0, -1) + t.trim();
        else cur.text += ` ${t.trim()}`;
        continue;
      }
      if (cur) out.push(cur);
      // only a FOLDED `>` block joins into one value; a literal `|` block keeps its lines (commands) separate
      cur = { i, text: t, indent: indent(l), block: /:\s+(?:[&!]\S+\s+)*>[+-]?\d*\s*$/.test(t) ? "pending" : false };
    }
    if (cur) out.push(cur);
    // a `\` continuation inside a literal `|` script: YAML strips the block's indentation, the shell then glues
    return joinContinuations(
      out.map(({ i, text }) => ({ i, text })),
      /(?<!\\)\\$/,
      ["block"],
    );
  }
  // a line continuation: `\` (sh, Dockerfile, a fenced block), PowerShell's backtick, cmd's `^`. How the next line
  // is spliced on differs by reader, so each join the reader might make is read (CONTINUATION_JOINS).
  const docker = /(?:^|\/)(?:Dockerfile|Containerfile)[^/]*$|\.(?:dockerfile|containerfile)$/i.test(path);
  // a Dockerfile as BuildKit parses it: `# escape=\`` (a parser directive, before any instruction) makes the
  // backtick the escape; whitespace may follow the escape; comment and empty lines inside a continuation are dropped
  // directives are read only while every line so far IS one (`syntax`, `escape`, `check`): an ordinary comment, an
  // unknown key, an empty line or an instruction ends them, and a later `# escape=` is a plain comment
  const directives = [];
  for (const [n, l] of lines.entries()) {
    // BuildKit strips leading whitespace and reads a non-empty value that may hold spaces (`check=skip=all; error=true`)
    const d = /^\s*#\s*(syntax|escape|check)\s*=\s*(.+?)\s*$/i.exec(n === 0 ? l.replace(/^\uFEFF/, "") : l);
    if (!d) break;
    directives.push(d);
  }
  const dockerEscape = docker && directives.some((d) => /^escape$/i.test(d[1]) && d[2] === "`") ? "`" : "\\";
  const [cont, modes] = /\.(?:ps1|psm1)$/i.test(path)
    ? [/(?<!`)`$/, ["space", "keep"]] // the escaped newline is whitespace; read glued too, fail-closed
    : /\.(?:cmd|bat)$/i.test(path)
      ? [/\^$/, ["keep"]] // `^` escapes the newline: the next line is appended as it stands
      : /(?:^|\/)(?:GNU)?makefile(?:\.(?:in|am))?$|\.(?:mk|make)$/i.test(path)
        ? [/(?<!\\)\\$/, ["tab"]] // make drops the recipe tail's leading tab, then the shell glues
        : docker
          ? [
              // under `# escape=\`` a heredoc body (`RUN <<EOF`) still reaches the shell raw, where `\` continues: read
              // both markers in that file, fail-closed, rather than track heredoc bounds
              dockerEscape === "`" ? /(?<!`)`[ \t]*$|(?<!\\)\\[ \t]*$/ : /(?<!\\)\\[ \t]*$/,
              ["keep", "strip"],
            ] // with and without the next line's indent, fail-closed
          : [/(?<!\\)\\$/, ["keep"]]; // the shell deletes `\<newline>` and keeps the next line whole
  if (kind === "json") return lines.map((text, i) => ({ i, text }));
  const ps1 = /\.(?:ps1|psm1)$/i.test(path);
  const physical = [];
  for (let i = 0; i < lines.length; i++) {
    // PowerShell: a backtick before a character escapes it (`context7`-mcp` is `context7-mcp`); the line-end one stays
    const l = ps1 ? lines[i].replace(/`(?=\S)/g, "") : lines[i];
    const at = l.search(/@upstash\\?\/context7-mcp/i);
    if (kind !== "json" && at >= 0 && i + 1 < lines.length && openQuote(l.slice(Math.max(0, l.lastIndexOf(" ", at)))) && openQuote(l)) {
      physical.push({ i, text: `${l} ${lines[i + 1].replace(/^\s*(?:\/\/+|#+|\*+|--)\s?/, "")}`, quoteJoin: true });
    } else physical.push({ i, text: l });
  }
  return joinContinuations(physical, cont, modes, docker ? (t) => /^\s*(?:#|$)/.test(t) : null);
}

/**
 * Pure: entries `{ i, text }` with continuation groups joined. A group is spliced the way a reader would splice it —
 * `keep` appends the next line as it stands (bash: `\<newline>` is deleted, nothing inserted), `strip` drops its
 * leading whitespace, `tab` drops one leading tab (a make recipe tail), `space` puts one space between, `block` drops up to the group's first-line indentation (a YAML
 * literal block's indent). One entry per mode is returned for a group that holds the package, so a pin or a name split
 * mid-token across the join is read as the shell would read it; a group without the package keeps its lines.
 */
export function joinContinuations(entries, cont, modes, skip = null) {
  const out = [];
  const NAME = /@upstash\\?\/context7-mcp/i;
  for (let k = 0; k < entries.length; k++) {
    // a skipped line (a Dockerfile comment, such as `# escape=\``) never starts a group either
    if (!cont.test(entries[k].text) || entries[k].quoteJoin || k + 1 >= entries.length || (skip && skip(entries[k].text))) {
      out.push({ i: entries[k].i, text: entries[k].text });
      continue;
    }
    // the group's members; `skip` lines inside it (a Dockerfile's comment and empty lines) are dropped, not joined
    const parts = [k];
    let j = k;
    while (j + 1 < entries.length && cont.test(entries[parts[parts.length - 1]].text)) {
      j++;
      if (!(skip && skip(entries[j].text))) parts.push(j);
    }
    const base = /^\s*/.exec(entries[k].text)[0].length;
    const joins = modes.map((mode) => {
      let text = entries[k].text.replace(cont, "");
      for (const n of parts.slice(1)) {
        const next = n !== parts[parts.length - 1] ? entries[n].text.replace(cont, "") : entries[n].text;
        const lead = /^\s*/.exec(next)[0].length;
        text +=
          mode === "space"
            ? ` ${next.trim()}`
            : mode === "strip"
              ? next.trimStart()
              : mode === "tab"
                ? next.replace(/^\t/, "")
                : mode === "block"
                  ? next.slice(Math.min(lead, base))
                  : next;
      }
      return text;
    });
    // a quote beside the marker (`"@upstash/context7-"\` + `mcp`) is concatenated by the shell: test quote-free too
    // and with escapes dropped (`context7\-\` + `mcp`): the shell removes both before the word is formed
    if (!joins.some((t) => NAME.test(t) || NAME.test(t.replace(/["']/g, "").replace(/\\(.)/g, "$1")))) {
      out.push({ i: entries[k].i, text: entries[k].text });
      continue;
    }
    for (const text of joins) out.push({ i: entries[k].i, text }); // the same line named twice is de-duplicated in the sweep
    k = j;
  }
  return out;
}

/** Pure: findings for one (logical) line's Context7 install references, read as the units its file kind defines. */
export function context7SpecFindings(line, pin, kind = "shell", before = "", after = "") {
  const out = [];
  const classify = (v) => (v === pin ? null : /^\d+\.\d+\.\d+$/.test(v) ? { stale: v } : { unpinned: v.slice(0, 24) || "<empty>" });
  const push = (f) => f && out.push(f);
  // a key naming the package — with or without an override selector — takes its WHOLE value
  for (const v of context7KeyValues(line, kind)) push(classify(v));
  // a runner on this line, or a `command: <runner>` on one of the lines just before (a multi-line MCP config)
  const runner =
    PACKAGE_RUNNER_RE.test(line) ||
    /["']?command["']?\s*[:=]\s*["']?(?:[^"'\n]*[\\/])?(?:npx|pnpx|bunx|uvx|bun|npm|pnpm|yarn|deno)(?:\.cmd|\.exe|\.ps1)?(?=["'\s,]|$)/im.test(`${before}\n${after}`);
  out.push(...context7UnitFindings(lineUnits(line, kind), pin, runner));
  if (CONTEXT7_GIT_SOURCE_RE.test(line) || (runner && CONTEXT7_SHORTHAND_RE.test(line))) out.push({ git: true });
  return out;
}

/** Pure: findings for argv-like units. An `npm:` alias with no version installs latest, so it is unpinned with or without a runner. */
export function context7UnitFindings(units, pin, runner, depth = 0) {
  const out = [];
  const classify = (v) => (v === pin ? null : /^\d+\.\d+\.\d+$/.test(v) ? { stale: v } : { unpinned: v.slice(0, 24) || "<empty>" });
  for (const unit of units) {
    // a unit that is itself a command (`sh -c "npx npm:pkg foo"`, a JSON `-c` argument): read its own words too
    // (a unit that IS a spec, or a `--flag=<spec>` argument, is one argv word and is read whole below)
    if (depth < 2 && /[\s;&|<>]/.test(unit) && /context7-mcp/i.test(unit) && !SPEC_VALUE_RE.test(unit) && !/^--?[\w-]+=/.test(unit)) {
      out.push(...context7UnitFindings(shellWords(unit), pin, runner || PACKAGE_RUNNER_RE.test(unit), depth + 1));
      continue;
    }
    for (const m of unit.matchAll(new RegExp(CONTEXT7_NAME_RE.source, CONTEXT7_NAME_RE.flags))) {
      const rest = unit.slice(m.index + m[0].length);
      if (rest.startsWith("@")) {
        const f = classify(shedMarkup(rest.slice(1)));
        if (f) out.push(f);
      } else if (/(?:^|[=:\s"'])npm:$/i.test(unit.slice(0, m.index))) out.push({ unpinned: "<none> (npm: alias)" });
      // in a runner context the name is versionless whenever `@<version>` does not follow it at once — whatever does
      // follow (a `\` continuation, `$(…)`, `${VAR}`, more text) cannot pin it
      else if (!/^["']?\s*[:=]/.test(rest) && runner) out.push({ bare: true });
    }
  }
  return out;
}

/** Pure: JSONC → JSON — `//` and block comments and trailing commas removed, never inside a string. Line breaks are kept. */
export function stripJsonc(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const m = /^"(?:\\.|[^"\\])*"/.exec(text.slice(i));
      const lit = m ? m[0] : text.slice(i);
      out += lit;
      i += lit.length - 1;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const body = text.slice(i, end < 0 ? text.length : end + 2);
      out += body.replace(/[^\n]/g, "");
      i += body.length - 1;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

/**
 * Pure: findings for a whole PARSED JSON document — keys, values and `command`/`args` context come from the
 * data, not from lines. `lineOf(needle)` maps a finding back to a line of the source. Null when `text` is not JSON.
 */
export function context7JsonFindings(text, pin) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    try {
      doc = JSON.parse(stripJsonc(text)); // JSONC: comments and trailing commas removed outside strings
    } catch {
      return null; // templates and other non-JSON: the line reader takes over
    }
  }
  const out = [];
  const nameLine = (() => {
    const at = text.search(/context7-mcp|upstash\\?\/context7/i);
    return at < 0 ? 1 : text.slice(0, at).split("\n").length;
  })();
  const lineOf = (needle) => {
    const at = needle ? text.indexOf(needle) : -1;
    return at < 0 ? nameLine : text.slice(0, at).split("\n").length;
  };
  const classify = (v) => (v === pin ? null : /^\d+\.\d+\.\d+$/.test(v) ? { stale: v } : { unpinned: String(v).slice(0, 24) || "<empty>" });
  const RUNNER_CMD = /^(?:npx|pnpx|bunx|uvx|bun|npm|pnpm|yarn|deno)(?:\.cmd|\.exe|\.ps1)?$/i;
  const RUNNER_WORD_RE = /(?:^|[\s\\/"'])(?:npx|pnpx|bunx|uvx|bun|npm|pnpm|yarn|deno)(?:\.cmd|\.exe|\.ps1)?(?=["'\s]|$)/i;
  // a command is a runner if its first word is one, or if the WHOLE value is a path to one (`C:\Program Files\nodejs\npx.cmd`)
  const isRunnerCommand = (c) =>
    typeof c === "string" &&
    (RUNNER_CMD.test(c.trim().split(/\s+/)[0].replace(/^.*[\\/]/, "")) ||
      RUNNER_CMD.test(c.trim().replace(/^["']|["']$/g, "").replace(/^.*[\\/]/, "")) ||
      // a runner path followed by flags (`/Users/John Smith/bin/npx -y`, `"C:\…\npx.cmd" -y`), or behind `env X=1`
      RUNNER_WORD_RE.test(c));
  const walk = (node, inArray, runner) => {
    if (Array.isArray(node)) {
      // `"args": ["/c", "npx", "-y", "@…"]` (Windows `cmd /c`): a runner element makes the array a runner call
      const here = runner || node.some((v) => typeof v === "string" && (isRunnerCommand(v) || PACKAGE_RUNNER_RE.test(v)));
      for (const v of node) walk(v, true, here);
    } else if (node && typeof node === "object") {
      // `command` as a string, or an object `{ path, args }` (Zed): read from the parent so `args` BESIDE it inherit the
      // runner, and from the object itself (its own `path`) for `args` inside it
      const here = runner || isRunnerCommand(node.command) ||
        isRunnerCommand(node.command?.path) ||
        // the program under another key (`cmd`, `program`), or a command ARRAY whose first word is the runner
        [node.command?.cmd, node.command?.program, node.path, node.cmd, node.program].some(isRunnerCommand) ||
        (Array.isArray(node.command) && isRunnerCommand(node.command[0]));
      for (const [k, v] of Object.entries(node)) {
        if (CONTEXT7_KEY_RE.test(k)) {
          const val = typeof v === "string" ? v : v && typeof v === "object" && typeof v["."] === "string" ? v["."] : null;
          const f = val === null ? null : classify(val);
          if (f) out.push({ line: lineOf(JSON.stringify(k).slice(1, -1)), f });
          if (typeof v !== "string") walk(v, false, here);
        } else walk(v, false, here);
      }
    } else if (typeof node === "string" && /context7/i.test(node)) {
      const units = inArray || SPEC_VALUE_RE.test(node) ? [node] : shellWords(node);
      const line = lineOf(JSON.stringify(node).slice(1, -1));
      for (const f of context7UnitFindings(units, pin, runner || PACKAGE_RUNNER_RE.test(node))) out.push({ line, f });
      if (CONTEXT7_GIT_SOURCE_RE.test(node) || ((runner || PACKAGE_RUNNER_RE.test(node)) && CONTEXT7_SHORTHAND_RE.test(` ${node} `)))
        out.push({ line, f: { git: true } });
    }
  };
  walk(doc, false, false);
  return out;
}

/**
 * Pure: every YAML KEY naming the package — anywhere on a line (block or flow mapping, nested), with or without a
 * path prefix (`foo>`, `**\/`, `parent/`) or a selector — and its value, taken from the same line, from the next
 * more-indented line (a value on the line after its key, or a folded/literal block), or from an explicit
 * `? key` / `: value` pair. Returns `{ i, value }` per key; each value must equal PINNED.
 */
export function context7YamlKeyScan(lines) {
  const out = [];
  const indent = (l) => /^\s*/.exec(l)[0].length;
  const nextValueLine = (i, base) => {
    let j = i + 1;
    while (j < lines.length && (lines[j].trim() === "" || lines[j].trim().startsWith("#"))) j++;
    return j < lines.length && indent(lines[j]) > base ? j : -1;
  };
  const oneScalar = (v, i, base) => {
    v = stripYamlProps(v.trim());
    if (/^[>|][+-]?\d*$/.test(v)) {
      // a block scalar: its more-indented lines, folded
      const parts = [];
      for (let j = nextValueLine(i, base); j >= 0 && j < lines.length; j++) {
        if (lines[j].trim() !== "" && indent(lines[j]) <= base) break;
        parts.push(lines[j].trim());
      }
      return parts.filter(Boolean).join(" ");
    }
    const q = /^("(?:\\.|[^"\\])*"|'(?:[^']|'')*')/.exec(v);
    return q ? unquote(q[1]) : v.split(/\s*[,}\]]/)[0].trim();
  };
  const KEY = /(["']?)((?:[^\s"'{},[\]#]*[>/])?@upstash\\?\/context7-mcp(?:@[^\s"':,{}[\]]*)?)\1\s*:(?=\s|$)/gi;
  for (let i = 0; i < lines.length; i++) {
    const l = stripYamlComment(lines[i]);
    const ex = /^(\s*(?:-\s+)*)\?(?:\s+(.*))?$/.exec(l);
    let exKey = ex ? stripYamlProps((ex[2] ?? "").trim()) : "";
    if (ex && (exKey === "" || /^[>|][+-]?\d*$/.test(exKey))) {
      // `?` alone, or `? |` / `? >`: the key is on the next more-indented line(s)
      const k = nextValueLine(i, indent(l));
      exKey = k < 0 ? "" : stripYamlProps(stripYamlComment(lines[k]).trim());
    }
    if (ex && CONTEXT7_KEY_RE.test(unquote(exKey).replace(/\\\//g, "/"))) {
      let j = i + 1;
      while (j < lines.length && !/^\s*(?:-\s+)*:(?:\s|$)/.test(lines[j]) && (lines[j].trim() === "" || indent(lines[j]) > indent(l))) j++;
      const val = j < lines.length ? /^\s*(?:-\s+)*:\s*(.*)$/.exec(stripYamlComment(lines[j])) : null;
      out.push({ i, value: val ? oneScalar(val[1], j, indent(l)) : "" });
      continue;
    }
    for (const m of l.matchAll(KEY)) {
      if (!CONTEXT7_KEY_RE.test(m[2].replace(/\\\//g, "/"))) continue;
      const after = l.slice(m.index + m[0].length).trim();
      if (after !== "") out.push({ i, value: oneScalar(after, i, indent(l)) });
      else {
        const j = nextValueLine(i, indent(l));
        out.push({ i, value: j < 0 ? "" : oneScalar(stripYamlComment(lines[j]), j, indent(l)) });
      }
    }
  }
  return out;
}

/**
 * Pure: FAIL-CLOSED for YAML values that ARE a Context7 spec but continue onto a more-indented line (a plain
 * or folded scalar, a next-line value, a bare `-` item). This parser-free gate cannot fold every YAML shape the
 * way a YAML reader does, so it refuses them: the pinned spec must be written whole on one line. Literal `|`
 * blocks are separate lines (commands) and are not refused. Returns `{ i, j }` (spec line, continuation line).
 */
export function yamlSpecContinuations(lines) {
  const out = [];
  const indent = (l) => /^\s*/.exec(l)[0].length;
  const blank = (l) => l.trim() === "" || l.trim().startsWith("#");
  for (let i = 0; i < lines.length; i++) {
    const l = stripYamlComment(lines[i]);
    const kv = /^\s*(?:-\s+)?(?:\?\s+)?(?:"(?:\\.|[^"\\])*"|'(?:[^']|'')*'|[^\s#"'][^#]*?)\s*:\s+(.*)$/.exec(l);
    const item = /^\s*-\s+(.*)$/.exec(l);
    const value = stripYamlProps((kv ? kv[1] : item ? item[1] : l).trim()).replace(/^["']/, "");
    if (!SPEC_VALUE_RE.test(value)) continue;
    let base = indent(l);
    if (!kv && !item) {
      // a value on its own line: its owner is the nearest less-indented line above
      let o = i - 1;
      while (o >= 0 && (blank(lines[o]) || indent(lines[o]) >= indent(l))) o--;
      // inside a literal `|` block the lines are separate (a script) — unless the spec is the block's FIRST line,
      // where the block is the value itself
      if (o >= 0 && /(?::\s*|^\s*)(?:[&!]\S+\s+)*\|[+-]?\d*\s*$/.test(stripYamlComment(lines[o]))) {
        let p = i - 1;
        while (p > o && blank(lines[p])) p--;
        if (p !== o) continue;
      }
      base = o >= 0 ? indent(lines[o]) : 0;
    }
    let j = i + 1;
    while (j < lines.length && blank(lines[j])) j++;
    if (j < lines.length && indent(lines[j]) > base) out.push({ i, j });
  }
  return out;
}

/** Pure: the tokenizing mode for a tracked path. */
export const context7FileKind = (path) => (/\.jsonc?$/i.test(path) ? "json" : /\.ya?ml$/i.test(path) ? "yaml" : "shell");

const CONTEXT7_PHRASE_RE = /context7[^0-9\n]{0,40}?(\d+\.\d+\.\d+)/gi;
export const CONTEXT7_PIN_HISTORY = [
  /^docs\/BUILD_BACKLOG\.md$/,
  /^docs\/agent\/RESOURCE_INTAKE\.md$/,
  /^docs\/DECISION_RECORDS\.md$/,
  /^artifacts\/lane-messages\//,
  /^third_party\//,
  /^scripts\/check-mcp-roster\.mjs$/,
];
export const CONTEXT7_PIN_COPIES = [
  { path: CONTEXT7_INSTALLER, re: /^\/\/ (\d+\.\d+\.\d+) published/g },
  { path: "docs/MCP_AND_SKILLS_LANE_PARITY.md", re: CONTEXT7_SPEC_RE },
  { path: ROSTER_PATH, re: /"packageVersion":\s*"([^"]+)"/g, section: /"id":\s*"context7"/ },
  { path: ROSTER_PATH, re: CONTEXT7_SPEC_RE, section: /"id":\s*"context7"/ },
  { path: "scripts/setup-mcp-lane.mjs", re: CONTEXT7_PHRASE_RE },
];

/** Pure: the version in install-context7's `export const PINNED = "@upstash/context7-mcp@X"`, or null. */
export function deriveContext7Pin(installerSource) {
  const m = /export const PINNED = "@upstash\/context7-mcp@([^"]+)"/.exec(installerSource ?? "");
  return m ? m[1] : null;
}

/**
 * Pure: every Context7 pin copy that differs from PINNED, as file:line findings.
 * `files` maps every tracked text path to its contents (the sweep's universe).
 */
export function checkContext7Pin({ installerSource, files, copies = CONTEXT7_PIN_COPIES, history = CONTEXT7_PIN_HISTORY }) {
  const pin = deriveContext7Pin(installerSource);
  if (!pin) return [`${CONTEXT7_INSTALLER}: no \`export const PINNED = "@upstash/context7-mcp@<version>"\` — the pin every copy is held to cannot be derived`];
  const problems = [];
  const stale = (path, line, v) => `${path}:${line}: Context7 pin copy says ${v}, but ${CONTEXT7_INSTALLER} PINNED is ${pin}`;

  // 1. the derived sweep
  let swept = 0;
  for (const [path, text] of Object.entries(files)) {
    if (typeof text !== "string" || history.some((re) => re.test(path))) continue;
    // the prefilter reads the text as a shell would rebuild it too — continuations spliced, quotes and escapes removed —
    // so `cont\<newline>ext7`, `context''7` or `context\7` is not skipped before the readers below see it
    // (a Dockerfile also drops comment and empty lines inside a continuation, and allows whitespace after the escape)
    const rebuilt = text
      .replace(/([\\`^])[ \t]*\r?\n(?:[ \t]*(?:#[^\n]*)?\r?\n)*[ \t]*/g, "")
      .replace(/["'\\`^]/g, "");
    if (!/context7/i.test(text) && !/context7/i.test(rebuilt) && !(context7FileKind(path) === "json" && /\\u00/i.test(text))) continue;
    const lines = text.split(/\r?\n/); // a CRLF file: every reader below sees lines without the `\r`
    const kind = context7FileKind(path);
    const seenAt = new Map(); // first line -> versions named by spec findings (so the phrase check does not double-report)
    const json = kind === "json" ? context7JsonFindings(text, pin) : null;
    const units = json
      ? [...new Set(json.map((x) => x.line))].map((ln) => ({ i: ln - 1, findings: json.filter((x) => x.line === ln).map((x) => x.f) }))
      : logicalLines(lines, kind, path).map(({ i, text: line }) => ({
          i,
          line,
          findings: context7SpecFindings(line, pin, kind, lines.slice(Math.max(0, i - 6), i).join("\n"), lines.slice(i + 1, i + 7).join("\n")),
        }));
    if (json) swept += (text.match(/upstash\\?\/context7-mcp/gi) ?? []).length;
    if (kind === "yaml") {
      const classify = (v) => (v === pin ? null : /^\d+\.\d+\.\d+$/.test(v) ? { stale: v } : { unpinned: v.slice(0, 24) || "<empty>" });
      for (const { i, value } of context7YamlKeyScan(lines)) {
        const f = classify(value);
        if (!f) continue;
        const u = units.find((x) => x.i === i);
        if (u) u.findings.push(f);
        else units.push({ i, findings: [f] });
      }
      for (const { i, j } of yamlSpecContinuations(lines)) {
        const u = units.find((x) => x.i === i);
        if (u && u.findings.length) continue; // already named
        problems.push(
          `${path}:${i + 1}: Context7 spec value continues on line ${j + 1} (a multi-line YAML value this gate cannot fold) — write the pinned spec whole on one line (PINNED ${pin})`,
        );
      }
    }
    for (const { i, line, findings } of units) {
      if (line !== undefined && /upstash\\?\/context7-mcp/i.test(line)) swept++;
      const seen = new Set();
      seenAt.set(i, seen);
      for (const f of findings) {
        if (f.stale) {
          seen.add(f.stale);
          problems.push(stale(path, i + 1, f.stale));
        } else if (f.git) {
          problems.push(`${path}:${i + 1}: Context7 is installed from a git/URL source, not the npm package pinned at ${pin} (${CONTEXT7_INSTALLER})`);
        } else if (f.unpinned) {
          seen.add(f.unpinned);
          problems.push(`${path}:${i + 1}: Context7 spec is UNPINNED (@${f.unpinned}), but ${CONTEXT7_INSTALLER} PINNED is ${pin}`);
        } else {
          problems.push(`${path}:${i + 1}: Context7 is invoked via a package runner with NO version, but ${CONTEXT7_INSTALLER} PINNED is ${pin}`);
        }
      }
    }
    lines.forEach((line, i) => {
      const seen = seenAt.get(i) ?? new Set();
      for (const m of line.matchAll(new RegExp(CONTEXT7_PHRASE_RE.source, CONTEXT7_PHRASE_RE.flags))) {
        swept++;
        if (m[1] === pin || seen.has(m[1]) || [...seen].some((v) => v.startsWith(m[1]))) continue;
        seen.add(m[1]);
        problems.push(stale(path, i + 1, m[1]));
      }
    });
  }

  // 2. the known sites must still hold a copy (and the roster's packageVersion is held here)
  for (const { path, re, section } of copies) {
    const text = files[path];
    if (typeof text !== "string") {
      problems.push(`${path}: unreadable — its Context7 pin copy cannot be checked against PINNED ${pin}`);
      continue;
    }
    const lines = text.split("\n");
    let from = 0;
    let to = lines.length;
    if (section) {
      from = lines.findIndex((l) => section.test(l));
      if (from < 0) {
        problems.push(`${path}: no line matching ${section} — the Context7 entry holding the pin copy is gone`);
        continue;
      }
      const next = lines.findIndex((l, i) => i > from && /"id":\s*"/.test(l));
      if (next > 0) to = next;
    }
    let seen = 0;
    for (let i = from; i < to; i++) {
      for (const m of lines[i].matchAll(new RegExp(re.source, re.flags))) {
        seen++;
        const v = re === CONTEXT7_SPEC_RE ? specToken(m[1]) : m[1];
        const msg = stale(path, i + 1, v);
        if (v !== pin && !problems.some((p) => p.startsWith(`${path}:${i + 1}:`))) problems.push(msg);
      }
    }
    if (!seen) problems.push(`${path}: no Context7 pin copy matching ${re} — reworded or removed, so the gate can no longer hold it to PINNED ${pin}`);
  }
  if (!swept) problems.push(`the Context7 pin sweep matched nothing across ${Object.keys(files).length} tracked file(s) — a sweep that sees nothing is not a pass`);
  return [...new Set(problems)]; // a continuation read two ways can name the same line twice
}

/**
 * Pure: one tracked file's bytes as sweepable text; never null. UTF-8 when there
 * is no NUL byte. Otherwise (binary or UTF-16) a latin1 reading, a UTF-16LE
 * reading and a byte-swapped (UTF-16BE) reading are joined — BOM or not — so an
 * ASCII spec is found whichever encoding wrote it.
 */
export function decodeTracked(buf) {
  if (!buf.includes(0)) return buf.toString("utf8");
  const even = buf.subarray(0, buf.length - (buf.length % 2));
  const swapped = Buffer.from(even).swap16();
  return `${buf.toString("latin1")}\n${even.toString("utf16le")}\n${swapped.toString("utf16le")}`;
}

/**
 * The sweep's universe: every tracked path. A symlink (git mode 120000) is held
 * by the link text git tracks, never followed (a link to a FIFO cannot hang the
 * gate); a gitlink (160000) has no content here. A path deleted in the worktree
 * is not a copy; any OTHER read error is returned in `unreadable` — reported,
 * never silently skipped.
 */
function loadContext7PinFiles() {
  const files = {};
  const unreadable = [];
  const entries = execSync("git ls-files -s -z", { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\0").filter(Boolean);
  for (const entry of entries) {
    const tab = entry.indexOf("\t");
    const mode = entry.slice(0, 6);
    const path = entry.slice(tab + 1);
    if (mode === "160000") continue;
    const abs = resolve(repo, path);
    try {
      files[path] = mode === "120000" ? readlinkSync(abs, "utf8") : decodeTracked(readFileSync(abs));
    } catch (e) {
      if (e?.code !== "ENOENT") unreadable.push(`${path}: unreadable (${e?.code ?? e}) — its Context7 pin copies cannot be checked`);
    }
  }
  return { files, unreadable };
}

/** Pure: the mcp__<server>__ prefixes (lowercased) named in a chunk of markdown. */
export function mcpServerNamesIn(text) {
  const out = new Set();
  for (const m of text.matchAll(/mcp__([A-Za-z0-9][A-Za-z0-9_-]*?)__/g)) out.add(m[1].toLowerCase());
  return out;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pure: which of `candidates` (a server id plus its aliases) appear in `text` as a
 * whole word, case-insensitively. A multi-word alias ("Neural Memory") is matched
 * literally with `\b` at each end, so internal spaces are not treated as
 * additional boundaries.
 */
function anyWholeWordIn(text, candidates) {
  return candidates.some((c) => new RegExp(`\\b${escapeRegExp(c)}\\b`, "i").test(text));
}

/**
 * Pure verdict. `roster` is a parsed object OR a raw string (unparseable input is
 * itself a finding, never thrown). `indexSource` is the mcp-server source text.
 * `skillDocs` is [{ dir, path, text }] for every *.md under every TRACKED
 * first-party skill dir; `firstPartyDirs` is that dir-name list.
 * Returns an array of problem strings; empty means clean.
 */
export function check({ roster, indexSource, skillDocs, firstPartyDirs }) {
  const problems = [];

  let r = roster;
  if (typeof r === "string") {
    try {
      r = JSON.parse(r);
    } catch (err) {
      return [`${ROSTER_PATH} does not parse as JSON: ${err.message}`];
    }
  }
  if (!r || typeof r !== "object" || !Array.isArray(r.servers) || !r.grants || typeof r.grants !== "object") {
    return [`${ROSTER_PATH} is missing servers[] or grants{} — fail-closed`];
  }

  // D1 — grants.lanes must be an object carrying cloud[] and mac[] arrays, and
  // grants.skills must be an object. No `?? {}` fallback on either: a document
  // that lost these nested maps is a FAIL, not "0 grants, PASS".
  const lanesRaw = r.grants.lanes;
  if (!lanesRaw || typeof lanesRaw !== "object" || Array.isArray(lanesRaw)) {
    problems.push(`${ROSTER_PATH}: grants.lanes is missing or not an object — fail-closed`);
  } else {
    for (const laneName of ["cloud", "mac"]) {
      if (!Array.isArray(lanesRaw[laneName])) problems.push(`${ROSTER_PATH}: grants.lanes.${laneName} is missing or not an array — fail-closed`);
    }
  }
  const skillsRaw = r.grants.skills;
  if (!skillsRaw || typeof skillsRaw !== "object" || Array.isArray(skillsRaw)) {
    problems.push(`${ROSTER_PATH}: grants.skills is missing or not an object — fail-closed`);
  }
  // Once either required map is unusable, the rest of this function has nothing
  // honest to check it against — report just the shape failures above.
  if (problems.length) return problems;

  const external = Array.isArray(r.external) ? r.external : [];
  const knownIds = new Set([...r.servers.map((s) => s.id), ...external.map((e) => e.id)]);
  const externalIds = new Set(external.map((e) => e.id));
  const dispositionById = new Map(r.servers.map((s) => [s.id, s.disposition]));
  const aliasesById = new Map(r.servers.map((s) => [s.id, Array.isArray(s.aliases) ? s.aliases : []]).concat(external.map((e) => [e.id, Array.isArray(e.aliases) ? e.aliases : []])));

  // r2 — signalgrid-mcp's tool count/names are DERIVED, never typed.
  const derived = deriveToolNames(indexSource);
  if (derived.length === 0) {
    problems.push(`${INDEX_PATH}: zero server.registerTool(...) calls matched — the derivation itself is broken`);
  }
  // The derivation only recognizes one call shape (`registerTool(\n  "name"`); a
  // registration written any other way (single line, single-quoted, etc.) would
  // silently vanish from `derived` while still counting toward the real total.
  // Cross-check against the plain call count so that shape drift fails closed.
  const plainCallCount = (indexSource.match(/registerTool\(/g) ?? []).length;
  if (plainCallCount !== derived.length) {
    problems.push(
      `${INDEX_PATH}: ${plainCallCount} registerTool( calls but only ${derived.length} in the derivable shape — a registration is written in a form the derivation does not recognize`,
    );
  }
  const sg = r.servers.find((s) => s.id === "signalgrid-mcp");
  if (!sg) {
    problems.push(`${ROSTER_PATH}: no servers[] entry with id "signalgrid-mcp"`);
  } else {
    if (sg.tools !== derived.length) {
      problems.push(`${ROSTER_PATH}: signalgrid-mcp.tools is ${sg.tools}, but ${INDEX_PATH} derives ${derived.length} registerTool(...) calls`);
    }
    // ORDERED array comparison (Codex #1127 finding 4): same length, same element
    // at each position — a Set-based compare hides both a duplicate and a
    // reordering, and the roster's own prose says toolNames is source-ordered.
    const roster_ = sg.toolNames ?? [];
    if (roster_.length !== derived.length) {
      problems.push(`${ROSTER_PATH}: signalgrid-mcp.toolNames has ${roster_.length} entries, but ${INDEX_PATH} derives ${derived.length}`);
    }
    const mismatchAt = [];
    for (let i = 0; i < Math.max(roster_.length, derived.length); i++) {
      if (roster_[i] !== derived[i]) mismatchAt.push(`[${i}] roster=${JSON.stringify(roster_[i])} derived=${JSON.stringify(derived[i])}`);
    }
    if (mismatchAt.length) {
      problems.push(`${ROSTER_PATH}: signalgrid-mcp.toolNames is out of order or mismatched against ${INDEX_PATH}'s derived order: ${mismatchAt.join("; ")}`);
    }
  }

  // r3 — every granted server id must exist; every skill-grant key must be first-party.
  const fpDirs = new Set(firstPartyDirs ?? []);
  if (fpDirs.size === 0) {
    problems.push(`${VENDORED_DOC}: zero first-party skill directories resolved — refusing to check skill grants against nothing`);
  }

  // D4 — a grant is allowed only onto an external[] entry, or a servers[] entry
  // whose disposition is exactly "adopted" or "adopted-by-reference".
  const ALLOWED_DISPOSITIONS = new Set(["adopted", "adopted-by-reference"]);
  const grantable = (server) => {
    if (externalIds.has(server)) return null; // external[] entries carry no disposition gate here
    const disp = dispositionById.get(server);
    if (!ALLOWED_DISPOSITIONS.has(disp)) return disp;
    return null;
  };

  const lanes = lanesRaw;
  for (const [lane, entries] of Object.entries(lanes)) {
    if (entries != null && !Array.isArray(entries)) {
      problems.push(`${ROSTER_PATH}: grants.lanes.${lane} must be an array, got ${typeof entries}`);
      continue;
    }
    for (const g of entries ?? []) {
      if (!knownIds.has(g.server)) {
        problems.push(`${ROSTER_PATH}: grants.lanes.${lane} names unknown server "${g.server}"`);
        continue;
      }
      const badDisp = grantable(g.server);
      if (badDisp !== null) problems.push(`${ROSTER_PATH}: grants.lanes.${lane} grants "${g.server}", whose disposition is "${badDisp}"`);
      // D3 — every lane grant needs a purpose and a source.
      if (typeof g.for !== "string" || g.for.trim() === "") problems.push(`${ROSTER_PATH}: grants.lanes.${lane} grants "${g.server}" with no non-empty "for"`);
      if (typeof g.source !== "string" || g.source.trim() === "") problems.push(`${ROSTER_PATH}: grants.lanes.${lane} grants "${g.server}" with no non-empty "source"`);
    }
  }
  const skillGrants = skillsRaw;
  for (const [skillDir, entries] of Object.entries(skillGrants)) {
    if (fpDirs.size > 0 && !fpDirs.has(skillDir)) {
      problems.push(`${ROSTER_PATH}: grants.skills has a key "${skillDir}" that is not a first-party skill directory`);
    }
    if (entries != null && !Array.isArray(entries)) {
      problems.push(`${ROSTER_PATH}: grants.skills.${skillDir} must be an array, got ${typeof entries}`);
      continue;
    }
    for (const g of entries ?? []) {
      if (!knownIds.has(g.server)) {
        problems.push(`${ROSTER_PATH}: grants.skills.${skillDir} names unknown server "${g.server}"`);
        continue;
      }
      const badDisp = grantable(g.server);
      if (badDisp !== null) problems.push(`${ROSTER_PATH}: grants.skills.${skillDir} grants "${g.server}", whose disposition is "${badDisp}"`);
      // D3 — every skill grant needs a purpose.
      if (typeof g.for !== "string" || g.for.trim() === "") problems.push(`${ROSTER_PATH}: grants.skills.${skillDir} grants "${g.server}" with no non-empty "for"`);
    }
  }

  // D3 (mentions half) — every grants.mentions entry needs a non-empty why. "$…" keys
  // (e.g. "$comment") are documentation, not a skill directory, and are skipped —
  // same convention the roster already uses at its top level.
  const mentionsRaw = r.grants.mentions && typeof r.grants.mentions === "object" ? r.grants.mentions : {};
  const mentions = Object.fromEntries(Object.entries(mentionsRaw).filter(([k]) => !k.startsWith("$")));
  for (const [skillDir, entries] of Object.entries(mentions)) {
    // A mentions key names a skill precedent/context reference, not a call — it is
    // checked against the same first-party directory set as grants.skills keys, so a
    // stray or misspelled skill directory here is caught the same way there.
    if (fpDirs.size > 0 && !fpDirs.has(skillDir)) {
      problems.push(`${ROSTER_PATH}: grants.mentions has a key "${skillDir}" that is not a first-party skill directory`);
    }
    if (entries != null && !Array.isArray(entries)) {
      problems.push(`${ROSTER_PATH}: grants.mentions.${skillDir} must be an array, got ${typeof entries}`);
      continue;
    }
    for (const m of entries ?? []) {
      if (!knownIds.has(m.server)) problems.push(`${ROSTER_PATH}: grants.mentions.${skillDir} names unknown server "${m.server}"`);
      if (typeof m.why !== "string" || m.why.trim() === "") problems.push(`${ROSTER_PATH}: grants.mentions.${skillDir} names "${m.server}" with no non-empty "why"`);
    }
  }

  // r4/D5 — a first-party skill doc's ACTUAL CALLS (an `mcp__<server>__` tool token)
  // must have a `grants.skills` entry — a `grants.mentions` entry means "not a call",
  // so it can satisfy only a MENTION (the server's id/alias appearing as a whole word
  // without a call token), never a call token itself; otherwise a mentions row could
  // silently clear a real call that has no grant. Calls and mentions are therefore
  // tracked as two separate named-sets, not merged into one.
  const grantedByskill = new Map();
  for (const [skillDir, entries] of Object.entries(skillGrants)) {
    if (!Array.isArray(entries)) continue; // already reported above
    grantedByskill.set(skillDir, new Set(entries.map((g) => String(g.server).toLowerCase())));
  }
  const mentionedByskill = new Map();
  for (const [skillDir, entries] of Object.entries(mentions)) {
    if (!Array.isArray(entries)) continue; // already reported above
    mentionedByskill.set(skillDir, new Set(entries.map((m) => String(m.server).toLowerCase())));
  }
  for (const { dir, path, text } of skillDocs ?? []) {
    const calledNames = mcpServerNamesIn(text); // mcp__<server>__ tokens — actual calls
    const mentionedNames = new Set();
    for (const id of knownIds) {
      const candidates = [id, ...(aliasesById.get(id) ?? [])];
      if (anyWholeWordIn(text, candidates)) mentionedNames.add(id.toLowerCase());
    }
    if (calledNames.size === 0 && mentionedNames.size === 0) continue;
    const granted = grantedByskill.get(dir) ?? new Set();
    const mentioned = mentionedByskill.get(dir) ?? new Set();
    for (const server of calledNames) {
      if (!granted.has(server)) {
        problems.push(`${path}: calls "mcp__${server}__..." but grants.skills.${dir} has no grant for it (a grants.mentions entry does not cover an actual call)`);
      }
    }
    for (const server of mentionedNames) {
      if (calledNames.has(server)) continue; // already checked above as a call
      if (!granted.has(server) && !mentioned.has(server)) {
        problems.push(`${path}: names "${server}" but grants.skills.${dir} has no grant and grants.mentions.${dir} has no mention for it`);
      }
    }
  }

  return problems;
}

function loadSkillDocs(firstPartyDirs) {
  const out = [];
  for (const dir of firstPartyDirs) {
    const base = `${SKILLS_DIR}/${dir}`;
    let files;
    try {
      files = execSync(`git ls-files -- ${base}`, { cwd: repo, encoding: "utf8" }).split("\n").filter((f) => f.endsWith(".md"));
    } catch {
      files = [];
    }
    for (const f of files) {
      if (!existsSync(resolve(repo, f))) continue;
      out.push({ dir, path: f, text: readFileSync(resolve(repo, f), "utf8") });
    }
  }
  return out;
}

function selfTest() {
  const goodIndex = `
server.registerTool(
  "alpha",
  {},
  async () => {},
);
server.registerTool(
  "beta",
  {},
  async () => {},
);
`;
  const goodRoster = {
    servers: [
      { id: "signalgrid-mcp", tools: 2, toolNames: ["alpha", "beta"], disposition: "adopted" },
      { id: "context7", tools: 2, disposition: "adopted" },
    ],
    external: [{ id: "firecrawl", decision: "adopted" }],
    grants: {
      lanes: { cloud: [{ server: "signalgrid-mcp", for: "x", source: "y" }], mac: [] },
      skills: { "loop-start": [{ server: "signalgrid-mcp", for: "x" }] },
    },
  };
  const fp = ["loop-start"];

  const run = (over = {}) =>
    check({
      roster: goodRoster,
      indexSource: goodIndex,
      skillDocs: [],
      firstPartyDirs: fp,
      ...over,
    });

  const checks = [];
  const expectFail = (name, over, want) => {
    const problems = run(over);
    checks.push([name, problems.some((p) => p.includes(want))]);
  };

  checks.push(["a clean roster passes", run().length === 0]);

  expectFail(
    "a wrong tools count FAILS",
    { roster: { ...goodRoster, servers: [{ ...goodRoster.servers[0], tools: 99 }, goodRoster.servers[1]] } },
    "signalgrid-mcp.tools is 99",
  );
  expectFail(
    "a missing toolName FAILS",
    { roster: { ...goodRoster, servers: [{ ...goodRoster.servers[0], toolNames: ["alpha"] }, goodRoster.servers[1]] } },
    "toolNames has 1 entries, but",
  );
  expectFail(
    "an extra toolName FAILS",
    { roster: { ...goodRoster, servers: [{ ...goodRoster.servers[0], toolNames: ["alpha", "beta", "ghost"] }, goodRoster.servers[1]] } },
    "toolNames has 3 entries, but",
  );
  expectFail(
    "a grant to an unknown server FAILS",
    { roster: { ...goodRoster, grants: { ...goodRoster.grants, lanes: { cloud: [{ server: "nope", for: "x", source: "y" }], mac: [] } } } },
    'unknown server "nope"',
  );
  expectFail(
    "a skill doc naming an ungranted mcp__ghost__x call FAILS",
    { skillDocs: [{ dir: "loop-start", path: ".claude/skills/loop-start/SKILL.md", text: "call mcp__ghost__x here" }] },
    'calls "mcp__ghost__..." but grants.skills.loop-start has no grant',
  );
  expectFail(
    "a grant to an evaluated-not-adopted server FAILS",
    {
      roster: {
        ...goodRoster,
        servers: [...goodRoster.servers, { id: "keycloak-admin", tools: 1, disposition: "evaluated-not-adopted" }],
        grants: { ...goodRoster.grants, lanes: { cloud: [{ server: "keycloak-admin", for: "x", source: "y" }], mac: [] } },
      },
    },
    'whose disposition is "evaluated-not-adopted"',
  );
  expectFail(
    "a grant to a deferred server FAILS",
    {
      roster: {
        ...goodRoster,
        servers: [...goodRoster.servers, { id: "postgres-hardened", tools: null, disposition: "deferred" }],
        grants: { ...goodRoster.grants, lanes: { cloud: [{ server: "postgres-hardened", for: "x", source: "y" }], mac: [] } },
      },
    },
    'whose disposition is "deferred"',
  );
  expectFail(
    "a registerTool( call in a shape the derivation doesn't recognize FAILS",
    { indexSource: goodIndex + `\nserver.registerTool("gamma", {}, async () => ({}));\n` },
    "registerTool( calls but only",
  );
  expectFail(
    "a roster missing servers[] or grants{} FAILS",
    { roster: { servers: goodRoster.servers } },
    "missing servers[] or grants{}",
  );
  expectFail(
    "zero registerTool(...) calls FAILS",
    { indexSource: "// no tools registered here" },
    "zero server.registerTool(...) calls matched",
  );
  expectFail(
    "zero first-party skill directories FAILS",
    { firstPartyDirs: [] },
    "zero first-party skill directories resolved",
  );
  expectFail(
    "a grants.skills key that is not a first-party skill directory FAILS",
    { roster: { ...goodRoster, grants: { ...goodRoster.grants, skills: { "ghost-skill": [{ server: "signalgrid-mcp", for: "x" }] } } } },
    'key "ghost-skill" that is not a first-party skill directory',
  );
  expectFail(
    "a grants.skills entry naming an unknown server FAILS",
    { roster: { ...goodRoster, grants: { ...goodRoster.grants, skills: { "loop-start": [{ server: "nope", for: "x" }] } } } },
    'grants.skills.loop-start names unknown server "nope"',
  );
  {
    const problems = run({ roster: "{ not json" });
    checks.push(["an unparseable roster FAILS", problems.length > 0 && problems[0].includes("does not parse")]);
  }

  // D1
  expectFail(
    "missing grants.lanes FAILS",
    { roster: { ...goodRoster, grants: { skills: goodRoster.grants.skills } } },
    "grants.lanes is missing or not an object",
  );
  expectFail(
    "missing grants.skills FAILS",
    { roster: { ...goodRoster, grants: { lanes: goodRoster.grants.lanes } } },
    "grants.skills is missing or not an object",
  );
  expectFail(
    "grants.lanes without 'mac' FAILS",
    { roster: { ...goodRoster, grants: { ...goodRoster.grants, lanes: { cloud: [] } } } },
    "grants.lanes.mac is missing or not an array",
  );

  // D2
  expectFail(
    "toolNames out of order FAILS",
    { roster: { ...goodRoster, servers: [{ ...goodRoster.servers[0], toolNames: ["beta", "alpha"] }, goodRoster.servers[1]] } },
    "toolNames is out of order or mismatched",
  );
  expectFail(
    "a duplicate toolName FAILS",
    { roster: { ...goodRoster, servers: [{ ...goodRoster.servers[0], tools: 2, toolNames: ["alpha", "alpha"] }, goodRoster.servers[1]] } },
    "toolNames is out of order or mismatched",
  );

  // D3
  expectFail(
    "a lane grant with no 'for' FAILS",
    { roster: { ...goodRoster, grants: { ...goodRoster.grants, lanes: { cloud: [{ server: "signalgrid-mcp", source: "y" }], mac: [] } } } },
    'grants "signalgrid-mcp" with no non-empty "for"',
  );
  expectFail(
    "a lane grant with no 'source' FAILS",
    { roster: { ...goodRoster, grants: { ...goodRoster.grants, lanes: { cloud: [{ server: "signalgrid-mcp", for: "x" }], mac: [] } } } },
    'grants "signalgrid-mcp" with no non-empty "source"',
  );

  // D4
  expectFail(
    "a disposition of 'totally-unknown' FAILS",
    {
      roster: {
        ...goodRoster,
        servers: [...goodRoster.servers, { id: "weird-server", tools: 1, disposition: "totally-unknown" }],
        grants: { ...goodRoster.grants, lanes: { cloud: [{ server: "weird-server", for: "x", source: "y" }], mac: [] } },
      },
    },
    'whose disposition is "totally-unknown"',
  );

  // D5
  expectFail(
    "a skill doc naming 'wazuh' with neither grant nor mention FAILS",
    {
      roster: { ...goodRoster, servers: [...goodRoster.servers, { id: "wazuh", tools: 1, disposition: "adopted-by-reference" }] },
      skillDocs: [{ dir: "loop-start", path: ".claude/skills/loop-start/SKILL.md", text: "this skill reads the live Wazuh dashboard for context" }],
    },
    'names "wazuh" but grants.skills.loop-start has no grant',
  );
  expectFail(
    "a mention with empty why FAILS",
    { roster: { ...goodRoster, grants: { ...goodRoster.grants, mentions: { "loop-start": [{ server: "firecrawl", why: "" }] } } } },
    'names "firecrawl" with no non-empty "why"',
  );
  expectFail(
    "a grants.mentions entry does NOT clear an actual mcp__ call FAILS",
    {
      roster: { ...goodRoster, grants: { ...goodRoster.grants, mentions: { "loop-start": [{ server: "context7", why: "precedent only" }] } } },
      skillDocs: [{ dir: "loop-start", path: ".claude/skills/loop-start/SKILL.md", text: "call mcp__context7__query-docs here" }],
    },
    'calls "mcp__context7__..." but grants.skills.loop-start has no grant',
  );
  expectFail(
    "a grants.mentions key that is not a first-party skill directory FAILS",
    { roster: { ...goodRoster, grants: { ...goodRoster.grants, mentions: { "ghost-skill": [{ server: "firecrawl", why: "x" }] } } } },
    'key "ghost-skill" that is not a first-party skill directory',
  );
  expectFail(
    "a non-array grants.skills entry FAILS instead of throwing",
    { roster: { ...goodRoster, grants: { ...goodRoster.grants, skills: { "loop-start": { server: "signalgrid-mcp", for: "x" } } } } },
    "grants.skills.loop-start must be an array, got object",
  );

  // Context7 pin parity, against the REAL tracked tree. Stale versions are built
  // at run time so this file never carries a literal stale pin of its own.
  const { files: pinFiles, unreadable: pinUnreadable } = loadContext7PinFiles();
  const realInstaller = pinFiles[CONTEXT7_INSTALLER] ?? "";
  const realPin = deriveContext7Pin(realInstaller);
  const OLD = ["4", "0", "4"].join(".");
  const SPEC = ["@upstash", "context7-mcp"].join("/") + "@";
  const pinRun = (over = {}, installer = realInstaller) => checkContext7Pin({ installerSource: installer, files: { ...pinFiles, ...over } });
  const appendTo = (path, line) => ({ [path]: `${pinFiles[path] ?? ""}\n${line}\n` });
  const lineCount = (path) => (pinFiles[path] ?? "").split("\n").length + 1;
  const names = (problems, path, line, v) => problems.some((p) => p.startsWith(`${path}:${line}: Context7 pin copy says ${v},`));
  checks.push(["the committed tree holds every Context7 pin copy at PINNED, every tracked path read", realPin !== null && pinRun().length === 0 && pinUnreadable.length === 0]);

  const bumped = realInstaller.replace(/(export const PINNED = "@upstash\/context7-mcp@)[^"]+"/, '$19.9.9"');
  const stale = pinRun({}, bumped);
  const expectStale = [];
  for (const [path, text] of Object.entries(pinFiles)) {
    if (path === CONTEXT7_INSTALLER || CONTEXT7_PIN_HISTORY.some((re) => re.test(path))) continue;
    text.split("\n").forEach((l, i) => {
      if (/@upstash\/context7-mcp@\d|context7[^0-9\n]{0,40}?\d+\.\d+\.\d+|"packageVersion":\s*"4/i.test(l) && (path !== ROSTER_PATH || /context7|packageVersion/.test(l)))
        expectStale.push(`${path}:${i + 1}:`);
    });
  }
  checks.push([
    `a bumped PINNED (9.9.9) names every stale copy (${expectStale.join(" ")})`,
    expectStale.length >= 5 && expectStale.every((loc) => stale.some((p) => p.startsWith(loc) && p.includes("PINNED is 9.9.9"))),
  ]);
  const plants = [
    ["docs/agent/mcp-roster-UNLISTED.md", `${SPEC}${OLD}`, "an UNLISTED file's package spec"],
    [".mcp.json", `"x": "${SPEC}${OLD}"`, "an unlisted .mcp.json key"],
    [".claude/skills/signalgrid-master/SKILL.md", `npx -y ${SPEC}${OLD}`, "the context7-granted skill's doc"],
    ["docs/MCP_AND_SKILLS_LANE_PARITY.md", `Context7 pinned at ${OLD}`, "a reworded phrase in a listed doc"],
    ["scripts/setup-mcp-lane.mjs", `// ${SPEC}${OLD}`, "the package-spec form in a phrase-shaped site"],
  ];
  for (const [path, line, what] of plants) {
    checks.push([`a stale pin in ${what} (${path}) is named`, names(pinRun(appendTo(path, line)), path, lineCount(path), OLD)]);
  }
  checks.push([
    "an UNPINNED spec (@latest) in an unlisted doc is named",
    pinRun(appendTo("docs/CI_AND_VALIDATION.md", `npx -y ${SPEC}latest`)).some((p) =>
      p.startsWith(`docs/CI_AND_VALIDATION.md:${lineCount("docs/CI_AND_VALIDATION.md")}: Context7 spec is UNPINNED (@latest)`),
    ),
  ]);
  for (const tag of ["^4.1.1", "~4.1.1", ">=4.1.1", "*", "4.1.x", "4", "4.0", `${realPin}-rc.1`]) {
    checks.push([
      `a loose spec @${tag} (range, wildcard, partial or prerelease) is named`,
      pinRun(appendTo("docs/CI_AND_VALIDATION.md", `npx -y "${SPEC}${tag}"`)).some((p) =>
        p.startsWith(`docs/CI_AND_VALIDATION.md:${lineCount("docs/CI_AND_VALIDATION.md")}: Context7 spec is UNPINNED (@${tag})`),
      ),
    ]);
  }
  checks.push([
    "an npx invocation with NO version is named",
    pinRun(appendTo("docs/CI_AND_VALIDATION.md", `run npx -y ${SPEC.slice(0, -1)} for docs`)).some((p) =>
      p.startsWith(`docs/CI_AND_VALIDATION.md:${lineCount("docs/CI_AND_VALIDATION.md")}: Context7 is invoked via a package runner with NO version`),
    ),
  ]);
  // Round-4 shapes, each checked on the pure per-line function: a finding of the right kind, or none.
  const kind = (line, k = "shell") => context7SpecFindings(line, realPin, k).map((f) => (f.stale ? "stale" : f.unpinned ? "unpinned" : f.git ? "git" : "bare"));
  const NAME = SPEC.slice(0, -1);
  for (const [line, want, what] of [
    [`npx -y ${SPEC} --flag`, "unpinned", "an empty token after @ (npm reads it as *)"],
    [`"args": ["-y", "${SPEC}"]`, "unpinned", "an empty token in a JSON args list"],
    [`npx -y "${SPEC}${realPin} - 9.9.9"`, "unpinned", "a quoted hyphen range starting at PINNED"],
    [`npx -y "${SPEC}${realPin} || ^5"`, "unpinned", "a quoted || union starting at PINNED"],
    [`npx ${SPEC}'latest'`, "unpinned", "a shell-quoted tag"],
    [`"${NAME}": "latest"`, "unpinned", "a package.json dependency on a tag"],
    [`"${NAME}": "^${realPin}"`, "unpinned", "a package.json range at PINNED"],
    [`"${NAME}": "${OLD}"`, "stale", "a package.json dependency on a stale version"],
    [`pnpm dlx ${NAME}`, "bare", "a versionless pnpm dlx call"],
    [`bunx ${NAME}`, "bare", "a versionless bunx call"],
    [`npm exec -- ${NAME}`, "bare", "a versionless npm exec call"],
    [`{"args":["-y","${SPEC.replace("/", "\\/")}latest"]}`, "unpinned", "the escaped-slash JSON form with a tag"],
    [`**${SPEC}${realPin}**`, null, "the CORRECT pin in markdown bold (no false positive)"],
    [`<code>${SPEC}${realPin}</code>`, null, "the CORRECT pin in an HTML tag (no false positive)"],
    [`"packageName": "${NAME}",`, null, "the roster's bare packageName (not a runner, not a dependency)"],
    // round 5: the spec is read as its shell/JSON ARGUMENT, not by terminator characters
    [`npx -y "${SPEC}${realPin} x || 5"`, "unpinned", "a quoted union whose text after PINNED is not `||`"],
    [`npx -y "${SPEC}${realPin}*||5"`, "unpinned", "a quoted `*||` union glued to PINNED"],
    [`"args": ["-y", "${SPEC}${realPin} <5 || >=5"]`, "unpinned", "a union range in a JSON args list"],
    [`npx -y ${SPEC}${realPin}"0"`, "stale", "shell concatenation onto PINNED (\"0\" makes 4.1.10)"],
    [`npx -y ${SPEC}${realPin}'||5'`, "unpinned", "a shell-quoted union glued to PINNED"],
    [`npx -y "${SPEC}${realPin}"0`, "stale", "text glued after the CLOSING quote (shell concatenation makes another version)"],
    [`"args": ["-y", "${SPEC}${realPin}"],`, null, "the CORRECT pin as a JSON argument (closing quote then `]`)"],
    [`npx -y github:upstash/context7#main`, "git", "a github: install source"],
    [`npx -y https://github.com/upstash/context7/tarball/main`, "git", "a tarball URL install source"],
    [`"upstream": "https://github.com/upstash/context7",`, null, "the roster's upstream repo URL (not an install source)"],
    [`bun x ${NAME}`, "bare", "a versionless bun x call"],
    [`pnpm exec ${NAME}`, "bare", "a versionless pnpm exec call"],
    [`deno run npm:${NAME}`, "unpinned", "a versionless deno run npm: call (an npm: alias with no version)"],
    [`${NAME}: latest`, "unpinned", "a YAML value that is a tag"],
    [`npx -y ${SPEC}${realPin} - see below`, null, "an UNQUOTED pin followed by prose (the shell splits it; no false positive)"],
    // round 6: lines are TOKENIZED as their reader would (shell words / JSON literals / YAML scalars)
    [`npx -y ${SPEC}${realPin}' || 5'`, "unpinned", "a quote opening at the END of the word (one shell word `…@4.1.1 || 5`)"],
    [`npx -y ${SPEC}${realPin}" - 5"`, "unpinned", "a double quote opening at the end of the word"],
    [`npx -y "--package=${SPEC}${realPin} x || 5" context7-mcp`, "unpinned", "a quoted argument with a --package= prefix"],
    [`deno run "npm:${SPEC}${realPin} || 5"`, "unpinned", "a quoted npm: argument"],
    [`npx -y ${SPEC}"${realPin}"`, null, "a quoted version the shell yields as PINNED (no false positive)"],
    [`[${SPEC}${realPin}](https://x)`, null, "a markdown link around the correct pin (no false positive)"],
    [`npx -y upstash/context7`, "git", "a github shorthand install"],
    [`npx -y git@github.com:upstash/context7.git`, "git", "an scp-style git install"],
    [`npx -y https://codeload.github.com/upstash/context7/tar.gz/main`, "git", "a codeload tarball install"],
    [`bun i ${NAME}`, "bare", "a versionless bun i call"],
    [`npx -y ${SPEC}${realPin}*`, "unpinned", "a trailing single `*` (a range) is not shed as markdown"],
    [`npx -y '${SPEC}${realPin}'`, null, "a single-quoted correct pin (quotes removed by the shell; no false positive)"],
    [`the cloud's lane pins ${SPEC}${realPin} today`, null, "an unbalanced prose apostrophe stays literal (no false positive)"],
  ]) {
    const got = kind(line);
    checks.push([`${what} → ${want ?? "no finding"}`, want ? got.length === 1 && got[0] === want : got.length === 0]);
  }
  for (const [line, k, want, what] of [
    [`    "${NAME}": "${realPin} || 5",`, "json", "unpinned", "a package.json dependency range with whitespace"],
    [`    "context7": "npm:${SPEC}${realPin} || 5",`, "json", "unpinned", "an npm: alias dependency with a union"],
    [`    "${NAME}": "${realPin}",`, "json", null, "the CORRECT package.json dependency (no false positive)"],
    [`      "build": "npm i ${SPEC}${realPin}, prebuilt dist; boots in under 1 s",`, "json", null, "the roster's build command string (shell-split; no false positive)"],
    [`  "args": ["-y", "--package=${SPEC}${realPin} || 5"]`, "json", "unpinned", "a JSON args element is ONE argv word"],
    [`    "${NAME.replace("/", "\\/")}": "latest",`, "json", "unpinned", "an escaped-slash JSON dependency key"],
    [`  - --package=${SPEC}${realPin} || 5`, "yaml", "unpinned", "a YAML sequence item is ONE argv word"],
    [`  run: npx -y ${SPEC}${realPin} --flag`, "yaml", null, "a YAML run: command (shell-split; no false positive)"],
  ]) {
    const got = kind(line, k);
    checks.push([`[${k}] ${what} → ${want ?? "no finding"}`, want ? got.length >= 1 && got.every((g) => g === want) : got.length === 0]);
  }
  // round 7: unquoted YAML aliases, block-scalar continuations, a runner on a preceding line, settle-until-stable markup
  for (const [line, k, before, want, what] of [
    [`  context7: npm:${SPEC}${realPin} || 5`, "yaml", "", "unpinned", "an UNQUOTED YAML npm: alias with a union (whole value)"],
    [`  c7: npm:${SPEC}${realPin} - 5 # pinned`, "yaml", "", "unpinned", "an unquoted YAML alias hyphen range with a comment"],
    [`    npm:${SPEC}${realPin} || 5`, "yaml", "  context7: >-", "unpinned", "a YAML block-scalar continuation that IS a spec"],
    [`  context7: npm:${SPEC}${realPin}`, "yaml", "", null, "the CORRECT unquoted YAML alias (no false positive)"],
    [`  foo: npx -y ${SPEC}${realPin} || 5`, "yaml", "", null, "a YAML command where `||` is a shell operator (no false positive)"],
    [`    "args": ["-y", "${NAME}"]`, "json", `  "context7": {\n    "command": "npx",`, "bare", "a versionless args element under a `command: npx` on the line before"],
    [`  - "${NAME}"`, "yaml", "  command: npx\n  args:", "bare", "a versionless YAML args item under `command: npx`"],
    [`    "args": ["-y", "${NAME}"]`, "json", `  "other": {\n    "url": "x",`, null, "a bare name with no runner nearby (no false positive)"],
    [`**${SPEC}${realPin}**.`, "shell", "", null, "bold then a sentence period (shed until stable; no false positive)"],
    [`| x | ${SPEC}${realPin}|`, "shell", "", null, "a markdown table cell glued to a pipe (no false positive)"],
    [`"dependencies": {"${NAME}": "${realPin}"}`, "json", "", null, "a one-line JSON dependency object (no false positive)"],
    [`"${NAME}" = "^4"`, "shell", "", "unpinned", "a TOML/ini `=` dependency range"],
  ]) {
    const got = context7SpecFindings(line, realPin, k, before).map((f) => (f.stale ? "stale" : f.unpinned ? "unpinned" : f.git ? "git" : "bare"));
    checks.push([`[${k}] ${what} → ${want ?? "no finding"}`, want ? got.length >= 1 && got.every((g) => g === want) : got.length === 0]);
  }
  // round 7b: values that SPAN lines (logical-line joining), override keys with a selector, exotic YAML spellings —
  // driven through the whole sweep on synthetic files, so the joiner and the key reader are both exercised
  const sweep = (path, body) => checkContext7Pin({ installerSource: realInstaller, files: { [path]: body }, copies: [] });
  const flags = (path, body, line) => sweep(path, body).some((p) => p.startsWith(`${path}:${line}: `));
  for (const [path, body, line, want, what] of [
    ["w.yaml", `x:\n    c7: npm:${SPEC}${realPin}\n      || 5\n`, 2, true, "a YAML plain scalar continued on the next line"],
    ["w.yaml", `x:\n    c7: "npm:${SPEC}${realPin}\n      || 5"\n`, 2, true, "a YAML double-quoted scalar over two lines"],
    ["w.yaml", `x:\n    c7: >-\n      npm:${SPEC}${realPin}\n      || 5\n`, 2, true, "a YAML folded block with the range on its second line"],
    ["w.yaml", `x:\n    c7: "npm:${SPEC}${realPin}\n      - 5"\n`, 2, true, "an open double quote whose continuation looks like a `- ` entry (hyphen range)"],
    ["w.yaml", `x:\n    c7: >-\n      npm:${SPEC}${realPin}\n      - 5\n`, 2, true, "a folded block whose continuation looks like a `- ` entry (hyphen range)"],
    ["s.mjs", `// npx -y "${SPEC}${realPin}\n// || 5"\n`, 1, true, "a shell quote left open after the package, closed on the next (comment) line"],
    ["package.json", `{\n  "pnpm": {"overrides": {"${SPEC}${realPin}": "^5"}}\n}\n`, 2, true, "a pnpm override key with a selector redirecting to a range"],
    ["package.json", `{\n  "overrides": {"${SPEC}4": "latest"}\n}\n`, 2, true, "an npm override key `@4` redirecting to a tag"],
    ["w.yaml", `overridesX:\n  "${SPEC}${realPin}": ^5\n`, 2, true, "a YAML override key with a selector"],
    ["w.yaml", `x: {c7: npm:${SPEC}${realPin} || 5}\n`, 1, true, "an alias range inside a YAML flow mapping"],
    ["w.yaml", `c7: &a npm:${SPEC}${realPin} || 5\n`, 1, true, "an alias range after a YAML anchor"],
    ["w.yaml", `c7: !!str npm:${SPEC}${realPin} || 5\n`, 1, true, "an alias range after a YAML tag"],
    ["w.yaml", `  "a:b": npm:${SPEC}${realPin} || 5\n`, 1, true, "a quoted YAML key containing `:`"],
    ["w.yaml", `? c7\n: npm:${SPEC}${realPin} || 5\n`, 2, true, "a YAML explicit key `? / :`"],
    ["package.json", `{"\\u0040upstash/context7-mcp": "^4"}\n`, 1, true, "a unicode-escaped JSON dependency key"],
    ["w.yaml", `  "@upstash\\/context7-mcp": latest\n`, 1, true, "a YAML double-quoted key with an escaped slash"],
    ["w.yaml", `  c7: "npm:${SPEC}${realPin} - 5 # c"\n`, 1, true, "a `#` INSIDE a quoted YAML value is not a comment"],
    ["w.yaml", `x:\n    c7: npm:${SPEC}${realPin}\n    other: 1\n`, 2, false, "a correct alias followed by a sibling key (no join; no false positive)"],
    ["w.yaml", `steps:\n  - run: |\n      npx -y ${SPEC}${realPin}\n      echo done\n`, 2, false, "a literal-block command whose next line is another command (no false positive)"],
    ["package.json", `{\n  "pnpm": {"overrides": {"${SPEC}4": "${realPin}"}}\n}\n`, 2, false, "an override key redirecting TO the pin (no false positive)"],
    ["d.md", `the cloud's pin is ${SPEC}${realPin} and Dan's too\n`, 1, false, "two prose apostrophes around a correct pin (no false positive)"],
    // round 8: YAML spec values that continue on more-indented lines are REFUSED (fail closed, whatever follows)
    ["w.yaml", `c7:\n  npm:${SPEC}${realPin}\n  || 5\n`, 2, true, "a YAML spec value starting on the line AFTER its key, continued"],
    ["w.yaml", `c7: npm:${SPEC}${realPin}\n    - 5\n`, 1, true, "a plain spec scalar continued by a `- `-looking line"],
    ["w.yaml", `- npm:${SPEC}${realPin}\n    - 5\n`, 1, true, "a sequence-item spec continued by a `- `-looking line"],
    ["w.yaml", `c7: npm:${SPEC}${realPin}\n\n    || 5\n`, 1, true, "a blank line between a spec value and its continuation"],
    ["w.yaml", `c7:\n  >-\n  npm:${SPEC}${realPin}\n  || 5\n`, 3, true, "`>-` on its own line below the key"],
    ["w.yaml", `args:\n  -\n    npm:${SPEC}${realPin}\n    || 5\n`, 3, true, "a bare `-` item with the spec on the next lines"],
    ["w.yaml", `deps:\n  c7:\n    npm:${SPEC}${realPin}\n    || 5\n`, 3, true, "a nested next-line spec value, continued"],
    ["w.yaml", `c7:\n  npm:${SPEC}${realPin}\nother: 1\n`, 2, false, "a next-line spec value followed by a sibling key (no false positive)"],
    ["w.yaml", `args:\n  - -y\n  - "${SPEC}${realPin}"\n  - --flag\n`, 3, false, "a spec item followed by sibling items (no false positive)"],
    ["w.yaml", `script: |\n  echo start\n  npm:${SPEC}${realPin}\n  echo next\n`, 3, false, "a spec line in the MIDDLE of a literal `|` script (separate lines; no false positive)"],
    ["w.yaml", `run: |\n  npx -y ${SPEC}${realPin}\n  echo next\n`, 2, false, "a literal `|` script whose first line runs the pin (no false positive)"],
    ["w.yaml", `c7: |\n  npm:${SPEC}${realPin}\n  || 5\n`, 2, true, "a literal `|` block whose FIRST line is the spec, continued (the block is the value)"],
    ["w.yaml", `run: >\n  npx -y ${SPEC}${realPin}\n  --flag\n`, 2, false, "a folded COMMAND continued by more args (not a spec value; no false positive)"],
    ["w.yaml", `c7: npm:${NAME}\n`, 1, true, "a versionless YAML npm: alias (installs latest)"],
    // round 8: path-style override/resolution keys
    ["w.yaml", `overrides:\n  "foo>${NAME}": ^5\n`, 2, true, "a pnpm `parent>pkg` override key (quoted)"],
    ["w.yaml", `overrides:\n  foo>${SPEC}${realPin}: ^5\n`, 2, true, "a pnpm `parent>pkg@sel` override key (unquoted)"],
    ["w.yaml", `resolutions:\n  "**/${NAME}": ^5\n`, 2, true, "a yarn `**/pkg` resolution key"],
    // round 9: YAML keys are found anywhere on a line (flow mappings, nested) and take values from later lines
    ["w.yaml", `${NAME}: ${realPin} || 5\n`, 1, true, "a YAML catalog value with a union"],
    ["w.yaml", `c7flow: {"${NAME}": "^5"}\n`, 1, true, "a Context7 key inside a YAML flow mapping"],
    ["w.yaml", `overrides: {"${NAME}": "latest"}\n`, 1, true, "a flow-mapping override to a tag"],
    ["w.yaml", `- {"${NAME}": "^5"}\n`, 1, true, "a flow mapping as a sequence item"],
    ["w.yaml", `pnpm: {overrides: {"${NAME}": "*"}}\n`, 1, true, "a nested flow mapping"],
    ["w.yaml", `x: {foo>${NAME}: ^5}\n`, 1, true, "an unquoted path key inside a flow mapping"],
    ["w.yaml", `resolutions: {"foo/${NAME}": "latest"}\n`, 1, true, "a yarn path key inside a flow mapping"],
    ["w.yaml", `overrides:\n  foo>${NAME}:\n    ^5\n`, 2, true, "an unquoted path key with its value on the NEXT line"],
    ["w.yaml", `resolutions:\n  foo/${NAME}:\n    latest\n`, 2, true, "a yarn path key with its value on the next line"],
    ["w.yaml", `overrides:\n  ? foo>${NAME}\n  : ^5\n`, 2, true, "an explicit `? key` / `: value` path override"],
    ["w.yaml", `deps: {"${NAME}": "${realPin}", other: 1}\n`, 1, false, "a flow mapping pinning the package correctly (no false positive)"],
    ["w.yaml", `overrides:\n  foo>${NAME}:\n    ${realPin}\n`, 2, false, "a next-line override value that IS the pin (no false positive)"],
    ["w.yaml", `overrides:\n  foo>${NAME}: >-\n    ${realPin}\n`, 2, false, "a folded-block override value that IS the pin (no false positive)"],
    ["w.yaml", `overrides:\n  foo>${NAME}: >-\n    ^5\n`, 2, true, "a folded-block override value that is a range"],
    ["s.sh", `C7=npm:${NAME}\n`, 1, true, "a versionless npm: alias after `NAME=`"],
    ["s.sh", `export C7="npm:${NAME}"\n`, 1, true, "a versionless npm: alias in an `export`"],
    // round 10: commands inside quoted strings, shell operators, prefixed/next-line explicit keys, runner context
    ["s.sh", `bash -c "npx npm:${NAME} foo"\n`, 1, true, "a versionless npm: alias inside a quoted `bash -c` command"],
    ["s.sh", `npx -y npm:${NAME}&&echo\n`, 1, true, "a versionless alias glued to a shell operator"],
    ["s.sh", `npx -y ${NAME}|cat\n`, 1, true, "a bare spec glued to a pipe"],
    ["c.json", `{"command":"bash","args":["-c","npx npm:${NAME} foo"]}`, 1, true, "a JSON `-c` argument holding a versionless command"],
    ["a.yml", `command: "npx npm:${NAME} foo"\n`, 1, true, "a YAML quoted command holding a versionless alias"],
    ["x.ts", `execSync("npx -y ${NAME} --stdio")\n`, 1, true, "a source-code string holding a versionless runner call"],
    ["a.yml", `- ? ${NAME}\n  : latest\n`, 1, true, "an explicit key behind a `- ` marker"],
    ["a.yml", `? &k ${NAME}\n: latest\n`, 1, true, "an explicit key behind an anchor"],
    ["a.yml", `?\n  ${NAME}\n: latest\n`, 1, true, "an explicit key on the line after a bare `?`"],
    ["a.yml", `? |\n  ${NAME}\n: latest\n`, 1, true, "an explicit block-scalar key"],
    [".mcp.json", `{"mcpServers":{"c7":{"command":"cmd","args":["/c","npx","-y","${NAME}"]}}}`, 1, true, "a Windows `cmd /c npx` MCP config, versionless"],
    ["config.toml", `[mcp_servers.context7]\ncommand = "npx"\nargs = ["-y", "${NAME}"]\n`, 3, true, "a TOML `command = \"npx\"` with a versionless args element"],
    ["README.md", `"args": ["-y", "${NAME}"],\n"command": "npx"\n`, 1, true, "args BEFORE command (runner within six lines after)"],
    ["c.json", `{"@upstash/\\u0063ontext7-mcp":"latest"}`, 1, true, "a JSON file spelling the name only through a \\u escape (not skipped by the prefilter)"],
    ["s.sh", `bash -c "npx -y ${SPEC}${realPin} --stdio"\n`, 1, false, "a quoted command running the pin (no false positive)"],
    ["s.sh", `npx -y ${SPEC}${realPin} && echo ok\n`, 1, false, "the pin followed by a shell operator (no false positive)"],
    [".mcp.json", `{"mcpServers":{"c7":{"command":"cmd","args":["/c","npx","-y","${SPEC}${realPin}"]}}}`, 1, false, "the Windows MCP config pinned (no false positive)"],
    ["a.yml", `- ? ${NAME}\n  : ${realPin}\n`, 1, false, "a prefixed explicit key pinned (no false positive)"],
    ["d.md", `say 'pinned ${SPEC}${realPin} today\n`, 1, false, "a lone, never-closed quote before a correct pin stays literal (no false positive)"],
    ["w.yaml", `deps: {"${NAME}": ${realPin}}\n`, 1, false, "a correct unquoted value closed by `}` in a YAML flow mapping (no false positive)"],
    // round 11: glued continuations/expansions after a versionless spec, prop-only explicit keys, spaced/object runner paths
    ["s.sh", `npx -y ${NAME}\\\n  --stdio\n`, 1, true, "a versionless spec glued to a `\\` line continuation"],
    ["Dockerfile", `RUN npx -y ${NAME}\\\n    --stdio\n`, 1, true, "a Dockerfile RUN with a glued `\\` continuation"],
    ["s.sh", `npx -y ${NAME}$(echo)\n`, 1, true, "a versionless spec glued to `$(…)`"],
    ["s.sh", `npx -y ${NAME}\${SUFFIX}\n`, 1, true, "a versionless spec glued to `\${VAR}`"],
    ["s.sh", `npx -y ${NAME}$EXTRA\n`, 1, true, "a versionless spec glued to `$VAR`"],
    ["package.json", `{"scripts":{"c7":"npx -y ${NAME}\\\\\\n --stdio"}}`, 1, true, "a package.json script with a glued continuation"],
    ["a.yml", `? &a\n  "${NAME}"\n: latest\n`, 1, true, "an explicit `?` line holding only an anchor, key on the next line"],
    ["a.yml", `? !!str\n  "${NAME}"\n: latest\n`, 1, true, "an explicit `?` line holding only a tag"],
    ["a.yml", `? !!str &a\n  "${NAME}"\n: latest\n`, 1, true, "an explicit `?` line holding a tag and an anchor"],
    [".mcp.json", `{"mcpServers":{"c7":{"command":"C:\\\\Program Files\\\\nodejs\\\\npx.cmd","args":["-y","${NAME}"]}}}`, 1, true, "a runner path with a space (Windows)"],
    [".mcp.json", `{"mcpServers":{"c7":{"command":"/Users/John Smith/.nvm/bin/npx","args":["-y","${NAME}"]}}}`, 1, true, "a runner path with a space (POSIX)"],
    ["settings.json", `{"context_servers":{"c7":{"command":{"path":"npx","args":["-y","${NAME}"]}}}}`, 1, true, "a Zed object-valued command"],
    [".mcp.json", `{"mcpServers":{"c7":{"command":"npx.ps1","args":["-y","${NAME}"]}}}`, 1, true, "a PowerShell `npx.ps1` runner"],
    ["config.toml", `[mcp_servers.context7]\ncommand = "C:\\\\Program Files\\\\nodejs\\\\npx.cmd"\nargs = ["-y", "${NAME}"]\n`, 3, true, "a TOML spaced runner path"],
    ["a.yml", `command: /Users/John Smith/bin/npx\nargs: ["-y", "${NAME}"]\n`, 2, true, "a YAML spaced runner path"],
    ["settings.json", `{"context_servers":{"c7":{"command":{"path":"npx","args":["-y","${SPEC}${realPin}"]}}}}`, 1, false, "the Zed config pinned (no false positive)"],
    ["s.sh", `npx -y ${SPEC}${realPin} \\\n  --stdio\n`, 1, false, "the pin followed by a continuation (no false positive)"],
    // round 12: CRLF explicit keys, case-insensitive runners, runner paths with flags, continuation-split runner/name
    ["a.yml", `? ${NAME}\r\n: latest\r\n`, 1, true, "a CRLF explicit `? key` / `: value` pair"],
    ["a.yml", `? &a\r\n  ${NAME}\r\n: latest\r\n`, 1, true, "a CRLF props-only explicit key"],
    ["a.yml", `? ${NAME}\r\n: ${realPin}\r\n`, 1, false, "a CRLF explicit key pinned (no false positive)"],
    ["s.sh", `NPX -y ${NAME}\n`, 1, true, "an upper-case `NPX` runner"],
    ["s.cmd", `NPX.CMD -y ${NAME}\n`, 1, true, "an upper-case `NPX.CMD` runner"],
    ["a.yml", `command: Npx\nargs: ["-y", "${NAME}"]\n`, 2, true, "a mixed-case `command: Npx`"],
    [".mcp.json", `{"command":"/Users/John Smith/bin/npx -y","args":["${NAME}"]}`, 1, true, "a spaced runner path plus flags in one command string"],
    [".mcp.json", `{"command":"\\"C:\\\\Program Files\\\\nodejs\\\\npx.cmd\\" -y","args":["${NAME}"]}`, 1, true, "a quoted spaced runner path plus flags"],
    [".mcp.json", `{"command":"env FOO=1 npx","args":["-y","${NAME}"]}`, 1, true, "a runner behind `env X=1`"],
    ["settings.json", `{"command":{"path":"npx"},"args":["-y","${NAME}"]}`, 1, true, "args BESIDE an object-valued command"],
    ["s.sh", `npx -y \\\n  ${NAME}\n`, 1, true, "a `\\` continuation splitting the runner from the name"],
    ["Dockerfile", `RUN npx \\\n    -y ${NAME}\n`, 1, true, "a Dockerfile RUN split across a continuation"],
    ["install.sh", `npx \\\n  --yes \\\n  ${NAME} \\\n  --api-key x\n`, 1, true, "a three-continuation install command"],
    ["README.md", "\`\`\`bash\nnpx -y \\\n  " + NAME + "\n\`\`\`\n", 2, true, "a fenced README block split across a continuation"],
    ["s.ps1", `npx -y \`\n  ${NAME}\n`, 1, true, "a PowerShell backtick continuation"],
    ["s.cmd", `npx -y ^\n  ${NAME}\n`, 1, true, "a cmd `^` continuation"],
    ["s.sh", `npx -y \\\n  ${SPEC}${realPin}\n`, 1, false, "the pin split across a continuation (no false positive)"],
    ["d.md", `a line ending in a hard break\\\nthen ${NAME} in prose\n`, 2, false, "a markdown hard break without a runner stays prose (no false positive)"],
    // round 13: a continuation splices the next line on with NOTHING between (bash), so a pin or a name split mid-token
    ["s.sh", `npx -y ${SPEC}${realPin}\\\n0\n`, 1, true, "a pin spliced across a continuation (`@4.1.1\\` + `0` runs 4.1.10)"],
    ["s.sh", `npx -y ${SPEC}${realPin}\\\n-beta.1\n`, 1, true, "a prerelease tail spliced onto the pin"],
    ["s.sh", `npx -y ${SPEC}${realPin}\\\r\n0\r\n`, 1, true, "a CRLF pin splice"],
    ["s.sh", `npx -y @upstash/context7-\\\nmcp@latest\n`, 1, true, "a package name split mid-token across a continuation"],
    ["s.sh", `npx -y @\\\nupstash/context7-mcp\n`, 1, true, "a name split right after the scope's `@`"],
    ["Dockerfile", `RUN npx -y @upstash/context7-\\\n    mcp@latest\n`, 1, true, "a Dockerfile name split with an indented tail"],
    ["s.cmd", `npx -y @upstash/context7-^\nmcp@latest\n`, 1, true, "a cmd `^` name split"],
    ["s.ps1", `npx -y ${SPEC}${realPin}\`\n0\n`, 1, true, "a PowerShell pin splice (read glued too, fail-closed)"],
    ["README.md", "\`\`\`sh\nnpx -y @upstash/context7-\\\nmcp@latest\n\`\`\`\n", 2, true, "a fenced README name split"],
    ["ci.yml", `steps:\n  - run: |\n      npx -y @upstash/context7-\\\n      mcp@latest\n`, 3, true, "a YAML literal-block name split"],
    ["ci.yml", `steps:\n  - run: |\n      npx -y \\\n        ${SPEC}${realPin}\n`, 3, false, "a YAML literal-block continuation holding the pin (no false positive)"],
    ["Dockerfile", `RUN npx -y \\\n    ${SPEC}${realPin}\n`, 1, false, "a Dockerfile continuation holding the pin, read both ways (no false positive)"],
    [".mcp.json", `{"command":["npx","-y"],"args":["${NAME}"]}`, 1, true, "a command ARRAY with args beside it"],
    [".mcp.json", `{"command":{"program":"npx"},"args":["-y","${NAME}"]}`, 1, true, "an object command under `program`"],
    // round 14: the prefilter reads the shell-rebuilt text; make recipe tails; YAML double-quoted escaped line breaks
    ["s.sh", `npx -y @upstash/cont\\\next7-mcp@latest\n`, 1, true, "a split INSIDE the word context7 (the file never spells it whole)"],
    ["s.sh", `npx -y @upstash/c\\\non\\\ntext7-mcp@latest\n`, 1, true, "a double continuation inside context7"],
    ["s.sh", `npx -y @upstash/context''7-mcp@latest\n`, 1, true, "quote concatenation rebuilding context7"],
    ["s.sh", `npx -y "@upstash/context"7-mcp@latest\n`, 1, true, "a double-quoted part rebuilding context7"],
    ["s.sh", `npx -y @upstash/context\\7-mcp@latest\n`, 1, true, "a backslash escape inside context7"],
    ["s.ps1", `npx -y @upstash/cont\`\next7-mcp@latest\n`, 1, true, "a PowerShell split inside context7"],
    ["Makefile", `x:\n\tnpx -y @upstash/context7-\\\n\tmcp@latest\n`, 2, true, "a make recipe name split with a tab-indented tail"],
    ["Makefile", `x:\n\tnpx -y ${SPEC}${realPin}\\\n\t0\n`, 2, true, "a make recipe pin splice (make runs 4.1.10)"],
    ["x.mk", `x:\n\tnpx -y @upstash/cont\\\n\text7-mcp@latest\n`, 2, true, "a .mk recipe split inside context7"],
    ["Makefile", `x:\n\tnpx -y ${SPEC}${realPin} \\\n\t--stdio\n`, 2, false, "a make recipe with the pin, then a spaced continuation (no false positive)"],
    ["w.yml", `steps:\n  - run: "npx -y @upstash/context7-\\\n      mcp@latest"\n`, 2, true, "a YAML double-quoted escaped line break inside the name"],
    ["w.yml", `a: "see C:\\path ${SPEC}${realPin}"\n`, 1, false, "a YAML double-quoted non-JSON escape does not throw (no false positive)"],
    // round 15: Dockerfile continuations as BuildKit reads them; a quote beside the marker; more make file names
    ["Dockerfile", `RUN npx -y @upstash/context7-\\\n# note\nmcp@latest\n`, 1, true, "a Dockerfile comment line inside a continuation"],
    ["Dockerfile", `RUN npx -y @upstash/cont\\\n# note\next7-mcp@latest\n`, 1, true, "a Dockerfile comment line inside a split of context7"],
    ["Dockerfile", `RUN npx -y @upstash/context7-\\\n\nmcp@latest\n`, 1, true, "a Dockerfile empty line inside a continuation"],
    ["Dockerfile", `RUN npx -y @upstash/context7-\\  \nmcp@latest\n`, 1, true, "a Dockerfile escape followed by whitespace"],
    ["Dockerfile", "# escape=\`\nRUN npx -y " + SPEC + realPin + "\`\n0\n", 2, true, "a Dockerfile `# escape=\`` pin splice"],
    ["Dockerfile", "# escape=\`\nRUN npx -y @upstash/cont\`\next7-mcp@latest\n", 2, true, "a Dockerfile `# escape=\`` split inside context7"],
    ["Dockerfile", `RUN npx -y ${SPEC}${realPin} \\\n  # note\n  --stdio\n`, 1, false, "a Dockerfile comment inside a pinned continuation (no false positive)"],
    ["s.sh", `npx -y "@upstash/context7-"\\\nmcp@latest\n`, 1, true, "a double-quoted part beside the continuation"],
    ["s.sh", `npx -y '@upstash/cont'\\\next7-mcp@latest\n`, 1, true, "a single-quoted part inside context7 beside the continuation"],
    ["Makefile.in", `x:\n\tnpx -y @upstash/context7-\\\n\tmcp@latest\n`, 2, true, "a Makefile.in recipe split"],
    ["foo.make", `x:\n\tnpx -y @upstash/context7-\\\n\tmcp@latest\n`, 2, true, "a *.make recipe split"],
    // round 16: directives end at the first non-directive line; escapes beside a split name; PowerShell escapes; Containerfile
    ["Dockerfile", "# hello\n# escape=\`\nRUN npx -y @upstash/context7-\\\nmcp@latest\n", 3, true, "an `# escape=` after an ordinary comment is a plain comment"],
    ["Dockerfile", "# foo=bar\n# escape=\`\nRUN npx -y @upstash/cont\\\next7-mcp@latest\n", 3, true, "an unknown directive ends directive parsing"],
    ["Dockerfile", "# syntax=docker/dockerfile:1\n# escape=\`\nRUN npx -y @upstash/context7-\`\nmcp@latest\n", 3, true, "`# escape=` after `# syntax=` still holds"],
    ["Dockerfile", "\uFEFF# escape=\`\nRUN npx -y @upstash/context7-\`\nmcp@latest\n", 2, true, "a BOM before the directive"],
    ["s.sh", `npx -y @upstash/context7\\-\\\nmcp@latest\n`, 1, true, "a backslash escape beside the continuation"],
    ["s.sh", `npx -y @upstash/context7-\\\nm\\cp@latest\n`, 1, true, "a backslash escape in the tail of a split name"],
    ["s.ps1", "npx -y @upstash/context7\`-\`\nmcp@latest\n", 1, true, "a PowerShell backtick escape beside the continuation"],
    ["Containerfile", `RUN npx -y @upstash/context7-\\\n# n\nmcp@latest\n`, 1, true, "a Containerfile read as a Dockerfile"],
    // round 17: BuildKit's directive grammar (indent, spaced values, empty value); heredoc bodies under a backtick escape
    ["Dockerfile", "  # escape=\`\nRUN npx -y @upstash/context7-\`\nmcp@latest\n", 2, true, "an indented `# escape=` directive"],
    ["Dockerfile", "# check=skip=all; error=true\n# escape=\`\nRUN npx -y @upstash/context7-\`\nmcp@latest\n", 3, true, "a directive value with a space keeps the scan going"],
    ["Dockerfile", "# check=\n# escape=\`\nRUN npx -y @upstash/context7-\\\nmcp@latest\n", 3, true, "an empty `# check=` ends directive parsing"],
    ["Dockerfile", "# escape=\`\nRUN <<EOF\nnpx -y @upstash/context7-\\\nmcp@latest\nEOF\n", 3, true, "a `\\` split inside a heredoc under `# escape=\`` "],
    ["Dockerfile", "# escape=\`\nRUN <<EOF\nnpx -y " + SPEC + realPin + " \\\n  --stdio\nEOF\n", 3, false, "a pinned heredoc continuation under `# escape=\`` (no false positive)"],
    ["ci.yml", `steps:\n  - run: |\n      npx -y \\\n        ${NAME}\n      echo done\n`, 3, true, "a YAML literal-block continuation splitting the runner from the name"],
    ["ci.yml", `steps:\n  - run: |\n      npx -y ${SPEC}${realPin}\n      echo ${NAME} ok\n`, 3, false, "literal-block lines stay separate commands (no false positive from the next line)"],
  ]) {
    checks.push([`[sweep ${path}] ${what} → ${want ? "named" : "no finding"}`, flags(path, body, line) === want && (want || sweep(path, body).length === 0)]);
  }
  checks.push([
    "a continuation read two ways names its line ONCE (problems are de-duplicated)",
    sweep("Dockerfile", `RUN npx -y \\\n    ${NAME}@latest\n`).length === 1,
  ]);
  // round 8: JSON is PARSED (JSON.parse) and walked — keys split from colons, path keys, command/args context
  for (const [body, want, what] of [
    [`{"pnpm":{"overrides":{"foo>${NAME}":"^5"}}}`, true, "a pnpm `parent>pkg` override (JSON)"],
    [`{"pnpm":{"overrides":{"foo@1>${NAME}":"latest"}}}`, true, "a pnpm `parent@1>pkg` override to a tag"],
    [`{"resolutions":{"**/${NAME}":"^5"}}`, true, "a yarn `**/pkg` resolution"],
    [`{"resolutions":{"foo/${NAME}":"^5"}}`, true, "a yarn `parent/pkg` resolution"],
    [`{\n "overrides": {\n  "${SPEC}${realPin}"\n  : "^5"\n }\n}`, true, "an override key split from its colon"],
    [`{"overrides":{"${NAME}":{".":"^5"}}}`, true, "an npm nested override `{\".\": range}`"],
    [`{"dependencies":{"x":"npm:${NAME}"}}`, true, "a versionless JSON npm: alias"],
    [`{"mcpServers":{"c7":{"command":"npx","args":["-y","${NAME}"]}}}`, true, "a one-line MCP config: command npx + bare args element"],
    [`{"mcpServers":{"c7":{"command":"npx","args":["-y","${SPEC}${realPin}"]}}}`, false, "the same MCP config pinned (no false positive)"],
    [`{"pnpm":{"overrides":{"foo>${NAME}":"${realPin}"}}}`, false, "a path override redirecting TO the pin (no false positive)"],
  ]) {
    const got = context7JsonFindings(body, realPin);
    checks.push([`[json parsed] ${what} → ${want ? "named" : "no finding"}`, got !== null && (want ? got.length >= 1 : got.length === 0)]);
  }
  checks.push(["JSONC (comments, trailing comma) is parsed after stripJsonc", context7JsonFindings(`{ // c\n "a": 1, /* x */ }`, realPin)?.length === 0]);
  checks.push([
    "a JSONC key split from its colon, under a comment, is named",
    (context7JsonFindings(`{\n // c\n "${SPEC}${realPin}"\n : "^5",\n}`, realPin) ?? []).length >= 1,
  ]);
  checks.push(["a `//` inside a JSON string is not a comment", JSON.parse(stripJsonc(`{"u": "https://x" /* c */} // c`)).u === "https://x"]);
  checks.push(["unparseable non-JSON (a template) falls back to the line reader", context7JsonFindings(`{ "a": {{ x }} }`, realPin) === null]);
  checks.push(["the file kind follows the extension", context7FileKind("a/package.json") === "json" && context7FileKind("x.yml") === "yaml" && context7FileKind("d.md") === "shell"]);
  const be16 = Buffer.from(`npx -y ${SPEC}${OLD}\n`, "utf16le").swap16(); // UTF-16BE, no BOM
  checks.push([
    "a stale spec in a BOM-less UTF-16BE file is still named after decodeTracked",
    pinRun({ "docs/agent/utf16be.md": decodeTracked(be16) }).some((p) => p.startsWith("docs/agent/utf16be.md:") && p.includes(`says ${OLD},`)),
  ]);
  const utf16 = Buffer.from(`\ufeffnpx -y ${SPEC}${OLD}\n`, "utf16le");
  checks.push([
    "a stale spec in a UTF-16LE file (BOM, NULs) is still named after decodeTracked",
    pinRun({ "docs/agent/utf16.md": decodeTracked(utf16) }).some((p) => p.startsWith("docs/agent/utf16.md:") && p.includes(`says ${OLD},`)),
  ]);
  checks.push([
    "the CORRECT pin ending a sentence (`…@<PINNED>.`) is not a false positive",
    pinRun(appendTo("docs/CI_AND_VALIDATION.md", `Use ${SPEC}${realPin}.`)).length === 0,
  ]);
  checks.push([
    "a capitalised-only `Context7 version <stale>` mention (case-insensitive prefilter) is named",
    names(pinRun({ "docs/agent/cap-only.md": `Pinned: Context7 version ${OLD}\n` }), "docs/agent/cap-only.md", 1, OLD),
  ]);
  checks.push([
    "a stale spec in a file with a NUL byte (binary) is still named, not skipped",
    names(pinRun({ "docs/agent/blob.bin": decodeTracked(Buffer.from(`\u0000\u0001junk\n${SPEC}${OLD}\n`, "latin1")) }), "docs/agent/blob.bin", 2, OLD),
  ]);
  checks.push([
    "a dated decision record (docs/DECISION_RECORDS.md) and a vendored third_party/ config are exempt, by name",
    pinRun({ ...appendTo("docs/DECISION_RECORDS.md", `Context7 ${OLD}`), "third_party/x/mcp.json": `"${SPEC}latest"` }).length === 0,
  ]);
  checks.push([
    "a stale pin in a dated history record (docs/agent/RESOURCE_INTAKE.md) is exempt, by name",
    pinRun(appendTo("docs/agent/RESOURCE_INTAKE.md", `${SPEC}${OLD}`)).length === 0,
  ]);
  checks.push(["an installer with no PINNED FAILS", pinRun({}, "const X = 1;").some((p) => p.includes("cannot be derived"))]);
  checks.push([
    "a reworded copy (no match left at a known site) FAILS instead of passing unseen",
    pinRun({ "scripts/setup-mcp-lane.mjs": "// Context seven, pinned" }).some((p) => p.startsWith("scripts/setup-mcp-lane.mjs: no Context7 pin copy")),
  ]);
  checks.push([
    "a roster with no context7 entry FAILS",
    pinRun({ [ROSTER_PATH]: "{}" }).some((p) => p.includes("Context7 entry holding the pin copy is gone")),
  ]);
  checks.push([
    "an empty sweep universe FAILS",
    checkContext7Pin({ installerSource: realInstaller, files: {}, copies: [] }).some((p) => p.includes("matched nothing")),
  ]);

  const bad = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok  " : "FAIL"} ${name}`);
  if (bad.length) {
    console.error(`check-mcp-roster self-test: ${bad.length} FAILED`);
    process.exit(1);
  }
  console.log(`check-mcp-roster self-test: ${checks.length}/${checks.length}`);
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();

  const rosterText = readFileSync(resolve(repo, ROSTER_PATH), "utf8");
  const indexSource = readFileSync(resolve(repo, INDEX_PATH), "utf8");
  const vendoredMd = readFileSync(resolve(repo, VENDORED_DOC), "utf8");
  const firstPartyDirs = firstPartySkillDirsIn(vendoredMd);
  const skillDocs = loadSkillDocs(firstPartyDirs);

  let roster;
  try {
    roster = JSON.parse(rosterText);
  } catch {
    roster = rosterText; // let check() report the parse failure uniformly
  }

  const { files: pinFiles, unreadable: pinUnreadable } = loadContext7PinFiles();
  const problems = [
    ...check({ roster, indexSource, skillDocs, firstPartyDirs }),
    ...pinUnreadable,
    ...checkContext7Pin({ installerSource: pinFiles[CONTEXT7_INSTALLER], files: pinFiles }),
  ];
  if (problems.length) {
    console.error(`check-mcp-roster FAIL — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }

  const nServers = Array.isArray(roster.servers) ? roster.servers.length : 0;
  const nExternal = Array.isArray(roster.external) ? roster.external.length : 0;
  const laneGrants = Object.values(roster.grants?.lanes ?? {}).reduce((n, a) => n + (a?.length ?? 0), 0);
  const skillGrantEntries = Object.values(roster.grants?.skills ?? {});
  const skillGrants = skillGrantEntries.reduce((n, a) => n + (a?.length ?? 0), 0);
  const mentionEntries = Object.entries(roster.grants?.mentions ?? {}).filter(([k]) => !k.startsWith("$"));
  const mentionCount = mentionEntries.reduce((n, [, a]) => n + (Array.isArray(a) ? a.length : 0), 0);
  const sg = roster.servers.find((s) => s.id === "signalgrid-mcp");
  const derived = deriveToolNames(indexSource);
  console.log(
    `mcp-roster: ${nServers} servers (+${nExternal} external), signalgrid-mcp ${sg?.tools ?? 0}/${derived.length} tools derived, ` +
      `${laneGrants} lane grants, ${skillGrants} skill grants over ${firstPartyDirs.length} first-party skills, ${mentionCount} mentions, ` +
      `Context7 pin ${deriveContext7Pin(pinFiles[CONTEXT7_INSTALLER])} held across ${Object.keys(pinFiles).length} tracked files swept ` +
      `(${CONTEXT7_PIN_HISTORY.length} exemption patterns: dated records, third_party/, this gate; ` +
      `${CONTEXT7_PIN_COPIES.length} known copies in ${new Set(CONTEXT7_PIN_COPIES.map((c) => c.path)).size} files present), 0 problems`,
  );
  console.log("PASS");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
