// Screen-inventory gate — docs/SCREEN_INVENTORY.md must list every page file of
// every web surface, and every launch status it states must be the one
// scripts/launch-profile.mjs holds (backlog row "Screen inventory and investor
// demo-path brief for the operator surfaces").
//
// WHY. The inventory is what a designer starts from and what an investor demo is
// planned against. A screen inventory that silently omits a page, still lists a
// deleted one, or calls a demo-only surface "launch" is worse than none: it is a
// scope claim nobody re-derived. So the doc's table is checked, both directions,
// against the tree and the launch profile — the status column is never retyped
// truth, only a copy the gate compares to the source.
//
// WHAT IS CHECKED, per row inside the <!-- screen-inventory:begin/end --> block:
//   · every git-tracked artifacts/*/src/pages/**/*.tsx appears exactly once
//     (a new page with no row FAILS)
//   · every listed file is tracked (a deleted or renamed page still listed FAILS)
//   · the surface column is the file's artifacts/<dir>
//   · the status column equals that surface's status in launch-profile.mjs
//     (an unclassified surface FAILS — the launch-profile gate owns classifying it)
//   · the placement column, for the admin console (signalgrid-app), equals what
//     its route table (src/App.tsx) actually does with the page: `launch route`,
//     `preview route (not launch UI)` (rendered under the PREVIEW banner),
//     `404 fallback`, or `not routed`; for every other surface it is `—`
//   · an admin page that is NOT on a launch route says so in the status column
//     too (`launch surface · not a launch screen`), because the profile classifies
//     the whole surface and a skimmer reads the Status column alone
//   · every <Route> in App.tsx has a shape this parser understands and names a
//     known page or preview wrapper. An unrecognised shape (an inline arrow
//     component, a spread, an unknown identifier) FAILS, whatever the doc says —
//     otherwise a page it could not see would read as `not routed` and pass.
//   · the "shows" column is not empty and not a placeholder (TBD, TODO, …); its
//     accuracy is still a human's job — nothing here can read a screen
//   · the doc names the launch-profile version it was checked against, and that
//     version is the current LAUNCH_PROFILE_VERSION
//
// `--self-test` proves each of those can fail on a synthetic case before the real
// check is trusted.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import MarkdownIt from "markdown-it";
import { parseFragment } from "parse5";
import ts from "typescript";
import { LAUNCH_PROFILE_VERSION, SURFACES } from "./launch-profile.mjs";

const DOC = "docs/SCREEN_INVENTORY.md";
const ADMIN = "signalgrid-app";
const ADMIN_ROUTES = `artifacts/${ADMIN}/src/App.tsx`;
const BEGIN = "<!-- screen-inventory:begin -->";
const END = "<!-- screen-inventory:end -->";
const PAGE_RE = /^artifacts\/([^/]+)\/src\/pages\/.+\.tsx$/;
// Demo step 4's launch arguments and the exact value each must carry (null: a URL,
// checked below). Values are read as the whole token after the flag, never as a
// substring somewhere in the step — round 4 showed `nurse.compliantX` and a swapped
// token beside "(not sgk_demo_northwind_operator)" both passing a substring check.
export const STEP4_FLAGS = {
  "-DemoBackendIdentity": "nurse.compliant",
  "-DemoBackendDevice": "ipad-ward-01",
  "-DemoBackendToken": "sgk_demo_northwind_operator",
  "-DemoBackendURL": null,
};
// The three hosts DemoMode.backendURL (native/ios/EnterpriseShell/Services/DemoMode.swift)
// accepts. It compares the LITERAL host Swift's URL(string:) yields, lowercased; it does
// not normalise. So the raw value must already be in this canonical form — round 5
// showed `127.1`, `0x7f.1`, `2130706433`, `[0:0:0:0:0:0:0:1]`, a slash-less `http:127…`
// and `127.0.0.1\@evil.com` all normalising to loopback under WHATWG while Swift's host
// is the literal text, nil, or the foreign host.
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const CANONICAL_LOOPBACK_URL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?(\/[^\s\\]*)?$/i;

/** surface id → status, from the app-surfaces entry of the launch profile. */
export function appSurfaceStatuses(surfaces = SURFACES) {
  const entry = surfaces.find((s) => s.key === "app-surfaces");
  if (!entry) throw new Error("launch-profile.mjs has no app-surfaces entry");
  const out = new Map();
  for (const status of ["launch", "deferred", "demo_only", "internal"]) {
    for (const item of entry[status] ?? []) out.set(typeof item === "string" ? item : item.id, status);
  }
  return out;
}

export const PREVIEW = "preview route (not launch UI)";

/**
 * Page path → placement, read from the admin console's route table by PARSING it with
 * the TypeScript compiler, not by scanning text.
 *
 * Why a parser: two review rounds found text-scanning fail-opens in both directions.
 * A `//` inside a string or inside JSX text looked like a comment and hid a real
 * <Route> (the page then read `not routed`); `<Route …>` text sitting inside a string
 * or template literal looked like a route and made a page no route renders read
 * `launch route`. Only the AST knows which `<Route` is a JSX element, so only JSX
 * elements named Route count, and anything about one this checker does not
 * understand — a child, a spread, an extra prop, a non-literal path, a component that
 * is not a bare identifier or names no page — is reported, never skipped. A file the
 * compiler cannot parse is reported too.
 *
 * Bindings read from the same AST: `import X from "@/pages/P"`,
 * `const X = named(() => import("@/pages/P"), …)`, `const Y = X` aliases and
 * `const Z = preview(X)` wrappers.
 */
export function adminPlacements(appSource) {
  const sf = ts.createSourceFile("App.tsx", appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const unparsed = sf.parseDiagnostics.map((d) => `does not parse: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  const pageOf = new Map(); // binding name → page path under src/pages
  const aliasOf = new Map();
  const previewOf = new Map();
  const routes = [];
  const pagePath = (n) => (n && ts.isStringLiteralLike(n) && n.text.startsWith("@/pages/") ? n.text.slice("@/pages/".length) : null);
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && node.importClause?.name) {
      const page = pagePath(node.moduleSpecifier);
      if (page) pageOf.set(node.importClause.name.text, page);
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const name = node.name.text;
      const init = node.initializer;
      if (ts.isIdentifier(init)) aliasOf.set(name, init.text);
      else if (ts.isCallExpression(init) && ts.isIdentifier(init.expression)) {
        const [first] = init.arguments;
        if (init.expression.text === "preview" && first && ts.isIdentifier(first)) previewOf.set(name, first.text);
        if (init.expression.text === "named" && first && ts.isArrowFunction(first) && ts.isCallExpression(first.body)
          && first.body.expression.kind === ts.SyntaxKind.ImportKeyword) {
          const page = pagePath(first.body.arguments[0]);
          if (page) pageOf.set(name, page);
        }
      }
    } else if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(sf) === "Route") {
      routes.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  for (let changed = true; changed; ) {
    changed = false;
    for (const [name, target] of aliasOf) if (!pageOf.has(name) && pageOf.has(target)) { pageOf.set(name, pageOf.get(target)); changed = true; }
  }
  const placement = new Map();
  const rank = { "launch route": 3, [PREVIEW]: 2, "404 fallback": 1 };
  const set = (page, p) => {
    if (!placement.has(page) || rank[p] > rank[placement.get(page)]) placement.set(page, p);
  };
  for (const el of routes) {
    const snippet = el.getText(sf).split("\n")[0].trim();
    if (ts.isJsxOpeningElement(el)) {
      unparsed.push(`unrecognised <Route> shape (has children): ${snippet}`);
      continue;
    }
    let path;
    let comp;
    let odd = false;
    for (const attr of el.attributes.properties) {
      if (!ts.isJsxAttribute(attr)) { odd = true; continue; }
      const key = attr.name.getText(sf);
      if (key === "path" && attr.initializer && ts.isStringLiteral(attr.initializer)) path = attr.initializer.text;
      else if (key === "component" && attr.initializer && ts.isJsxExpression(attr.initializer)
        && attr.initializer.expression && ts.isIdentifier(attr.initializer.expression)) comp = attr.initializer.expression.text;
      else odd = true;
    }
    if (odd || !comp) {
      unparsed.push(`unrecognised <Route> shape: ${snippet}`);
      continue;
    }
    if (previewOf.has(comp) && pageOf.has(previewOf.get(comp))) set(pageOf.get(previewOf.get(comp)), PREVIEW);
    else if (pageOf.has(comp)) set(pageOf.get(comp), path !== undefined ? "launch route" : "404 fallback");
    else unparsed.push(`<Route> component ${comp} resolves to no page under src/pages: ${snippet}`);
  }
  return { placement, unparsed }; // placement keys like "decisions/DecisionList"
}

function adminPageKey(file) {
  return file.replace(`artifacts/${ADMIN}/src/pages/`, "").replace(/\.tsx$/, "");
}

/** Why a -DemoBackendURL value would not reach a loopback api-server, or null if it would. */
export function urlProblem(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    return "it is not a URL";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return `its scheme is ${u.protocol} (http or https only)`;
  if (u.username || u.password) return `it carries userinfo, so its real host is ${u.hostname}`;
  if (!LOOPBACK.has(u.hostname)) return `its host is ${u.hostname} (loopback only: localhost, 127.0.0.1, ::1)`;
  if (u.port === "0") return "its port is 0, which no api-server listens on, so every request fails and the shell falls back on-device";
  // WHATWG agreed it is loopback; the shell compares the literal text, so require it.
  if (!CANONICAL_LOOPBACK_URL.test(value))
    return "it is not written as http(s)://localhost|127.0.0.1|[::1][:port][/path] — the shell compares the literal host, so a shorthand, non-canonical or backslash form is not loopback to it";
  return null;
}

/**
 * The TEXT of demo step 4 as a reader sees and copies it — not its markdown source.
 *
 * Rounds 4–7 of review were all one gap: the gate read raw markdown while an operator
 * copies the rendered page. Round 8 found the same gap one level down: raw HTML was
 * stripped by hand-written regexes, which disagree with a browser on RCDATA
 * (`<textarea>`), on comment ends (`<!-->`, `--!>`), on `<?…?>`, and on text that is
 * in the DOM but never shown (`hidden`, `display:none`, `<style>`).
 *
 * So there are no regexes over HTML here. markdown-it (`html: true`) renders the demo
 * section; parse5, an HTML5-conformant parser, builds the tree a browser would; the
 * text is read from that tree the way a browser shows it (comments, script, style,
 * template, noscript and hidden elements skipped; RCDATA such as textarea kept).
 *
 * And because no tree walk can evaluate CSS, and renderers disagree on raw HTML (GitHub
 * strips `<style>`; a local preview does not), raw HTML anywhere in the demo section is
 * refused outright, as are images (alt text shows only when an image fails to load).
 * The text is still read, so a raw-HTML step reports its flag problems too.
 *
 * Returns { text, problems } for the one list item numbered 4 in the one section
 * headed "## The demo path" (up to the next h1/h2), or { text: null, problems } when
 * that section or item is missing or ambiguous.
 */
export function renderedStep4(doc) {
  const md = new MarkdownIt({ html: true });
  const tokens = md.parse(doc, {});
  const problems = [];
  const headingText = (i) => tokens[i + 1]?.type === "inline" ? tokens[i + 1].content.trim() : "";
  const sections = tokens.flatMap((t, i) =>
    t.type === "heading_open" && t.tag === "h2" && /^The demo path\b/.test(headingText(i)) ? [i] : []);
  if (sections.length === 0) return { text: null, problems: ["no \"## The demo path\" section"] };
  if (sections.length > 1) problems.push(`${sections.length} "## The demo path" sections — the demo path must be stated once`);
  const from = sections[0];
  // Only a TOP-LEVEL h1/h2 ends the section (round 9): a heading nested in a list item
  // or a blockquote renders inside step 4, so the text after it is still step 4.
  let to = tokens.findIndex((t, i) => i > from + 2 && t.level === 0 && t.type === "heading_open" && (t.tag === "h1" || t.tag === "h2"));
  if (to < 0) to = tokens.length;
  const section = tokens.slice(from, to);
  if (section.some((t) => t.type === "html_block" || (t.type === "inline" && t.children.some((c) => c.type === "html_inline"))))
    problems.push("the demo path section contains raw HTML — the gate cannot know how every renderer shows it, so write it in markdown");
  // Step 4 is the item a reader SEES as 4 (round 9). A browser numbers <ol> items in
  // order from the list's start, whatever marker the source wrote, so `1. 2. 3. 3. 4.`
  // shows the second `3.` as step 4. Every ordered-list item's rendered number is
  // computed, a marker that disagrees with it fails, and step 4 is chosen by it.
  // GitHub renders with cmark-gfm, markdown-it does not (round 10). Where the two
  // disagree on plain markdown, the gate cannot know what a reader sees, so the
  // syntax is refused: a footnote definition is step text to markdown-it but dropped
  // or moved to the page foot by GitHub, and `$…$` is math on GitHub. Checked on the
  // inline source, before any rendering, so no escape or entity spelling hides it.
  const inlines = section.filter((t) => t.type === "inline");
  if (inlines.some((t) => t.content.includes("[^")))
    problems.push("the demo path section uses footnote syntax ([^…]) — GitHub drops or moves footnotes, so write it in the step");
  if (inlines.some((t) => t.content.includes("$")))
    problems.push("the demo path section contains `$` — GitHub renders $…$ as math, so the text a reader sees differs");
  // Round 11 found the next renderer disagreement (a ```math or ```mermaid fence is
  // typeset or drawn on GitHub, not copyable text), so the section is now held to an
  // ALLOW-list instead of a growing deny-list: only the constructs both renderers show
  // the same way. Anything else — a fence language GitHub renders, a hard break,
  // a link, a blockquote, a table, a heading, strikethrough, a bare URL GitHub would
  // autolink — fails, and a new GFM extension fails by default.
  const refuse = (what) => problems.push(`the demo path section uses ${what} — it may hold only paragraphs, ordered lists, fenced blocks with no language or sh/bash/text, and plain, bold, italic or code text, so it reads the same on GitHub as in the gate`);
  const seen = new Set();
  const once = (key, what) => { if (!seen.has(key)) { seen.add(key); refuse(what); } };
  for (const t of section.slice(3)) {
    if (t.type === "fence") {
      if (!/^(?:|sh|bash|shell|console|text)$/i.test(t.info.trim())) once(`fence:${t.info.trim()}`, `a fenced block with info "${t.info.trim()}"`);
    } else if (!BLOCKS_OK.has(t.type)) once(t.type, `markdown that renders as ${t.type.replace(/_(open|close)$/, "")}`);
    for (const c of t.children ?? []) {
      if (!INLINE_OK.has(c.type)) once(c.type, `inline markdown that renders as ${c.type.replace(/_(open|close)$/, "")}`);
      else if (c.type === "text" && /(?:https?:\/\/|www\.)/i.test(c.content)) once("autolink", `a bare URL in prose ("${c.content.trim().slice(0, 40)}"), which GitHub autolinks — put it in a code span or the fenced block`);
    }
  }
  // A line whose text a reader sees as a step number — "4.", "4\.", "4&#46;", a line
  // after a break, "Step 4.", "４.", "⒋", "IV." — is a step to the eye but not a list
  // item, so the gate would never pick it as step 4 (rounds 10–11). Read per rendered
  // line, any Unicode digit, any dot-like separator.
  for (const t of inlines) {
    const shown = visibleText(parseFragment(md.renderer.renderInline(t.children, md.options, {})));
    for (const line of shown.split("\n")) {
      if (/^\s*(?:step\s*)?(?:\p{N}+|[ivxlcdm]+)\s*[.)\u2024\uFE52\uFF0E\uFF09\u06D4:](?:\s|$)/iu.test(line) || /^\s*[\u2488-\u249B]/u.test(line))
        problems.push(`the demo path has a line that reads as a numbered step but is not a list item: "${line.trim().slice(0, 40)}"`);
    }
  }
  const items = [];
  const lists = [];
  for (const [i, t] of section.entries()) {
    if (t.type === "ordered_list_open") lists.push({ next: Number(t.attrGet("start") ?? 1) });
    else if (t.type === "bullet_list_open") lists.push(null);
    else if (t.type === "ordered_list_close" || t.type === "bullet_list_close") lists.pop();
    else if (t.type === "list_item_open" && lists.at(-1)) {
      const shown = lists.at(-1).next++;
      if (t.info !== String(shown)) problems.push(`a demo-path list item written "${t.info}." renders as ${shown} — number the steps in order`);
      if (shown === 4) items.push(i);
    }
  }
  if (items.length === 0) return { text: null, problems: [...problems, "the demo path has no step numbered 4"] };
  if (items.length > 1) problems.push(`${items.length} list items numbered 4 in the demo path — step 4 must be stated once`);
  const open = items[0];
  let close = open + 1;
  for (let depth = 0; close < section.length; close += 1) {
    if (section[close].type === "list_item_open") depth += 1;
    if (section[close].type === "list_item_close") {
      if (depth === 0) break;
      depth -= 1;
    }
  }
  const body = section.slice(open + 1, close);
  if (body.some((t) => t.type === "inline" && t.children.some((c) => c.type === "image")))
    problems.push("demo step 4 contains an image — its alt text shows only if it fails to load");
  const html = md.renderer.render(body, md.options, {});
  return { text: visibleText(parseFragment(html)), problems };
}

// A footnote definition opener as GitHub's cmark-gfm reads one — `[^label]:` at the
// start of a line, after any indentation, blockquote `>` or list markers. cmark-gfm's
// own scanner wants a label with no space and no `]`; this matches any label, so it
// refuses a superset of what GitHub treats as a definition.
const FOOTNOTE_DEF_LINE = /^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t>]+)*\[\^[^\]\n]*\]:/;
// Deepest block nesting allowed; the file itself nests 4 deep. Far below markdown-it's
// maxNesting (100), past which it silently stops tokenizing (round 20).
const MAX_DEPTH = 16;
// A line that starts with `<` after any indentation, blockquote `>` or list markers.
const HTML_START_LINE = /^[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])[ \t>]+)*</;
// A paragraph or heading whose inline text opens with `[label]:` is a link reference
// definition markdown-it REJECTED (an accepted one never reaches an inline token). cmark-gfm
// does not validate the destination, so it hides the same text.
const REJECTED_REF_DEF = /^\[(?:[^\]\\]|\\.)+\]:/;

/**
 * True when a raw source line holds `<` (or an entity or escape that renders as one)
 * anywhere but inside a code span the two renderers are certain to agree on: opened by
 * ONE backtick that starts its word (line start, whitespace or `(`, the word not a URL) and
 * closed by the next lone backtick on the same line, with no
 * `|` inside (a table splits cells on `|` before it reads code spans). Round 21: the
 * markdown-it check below exempts whatever markdown-it calls code, and markdown-it calls
 * an 81-backtick run code where cmark-gfm (MAXBACKTICKS 80) calls it text, so a tag
 * between two such runs was live HTML on GitHub. This scan reads the raw line instead.
 */
export function rawLtOutsideSimpleCode(line) {
  const safe = [];
  for (let j = 0; j < line.length; ) {
    if (line[j] !== "`") { j += 1; continue; }
    let run = 1;
    while (line[j + run] === "`") run += 1;
    // The opening backtick must start its word (line start, space, tab or `(`) and that word
    // must not be a URL: GitHub's autolink extension runs a `http://`, `ftp://` or `www.`
    // link up to the next space and takes a touching backtick with it, so the tag after
    // it is raw HTML on GitHub while markdown-it, with linkify off, reads a code span
    // (round 22). Every code span in this file opens after a space, `(` or line start.
    // ASCII space and tab only (round 23): cmark-gfm ends an autolink at ASCII whitespace
    // alone, so an NBSP, U+2029, U+3000, VT or FF is still part of the URL to GitHub.
    const word = line.slice(0, j).split(/[ \t]/).pop();
    if (run === 1 && (j === 0 || /[ \t(]/.test(line[j - 1])) && !/:\/\/|www\./i.test(word)) {
      let k = j + 1;
      while (k < line.length && !(line[k] === "`" && line[k - 1] !== "`" && line[k + 1] !== "`")) k += 1;
      if (k < line.length && !line.slice(j, k).includes("|")) { safe.push([j, k]); j = k + 1; continue; }
    }
    j += run;
  }
  const inSafe = (x) => safe.some(([a, b]) => x > a && x < b);
  for (const m of line.matchAll(/<|&(?:lt|#0*60|#x0*3c)|\\</gi)) if (!inSafe(m.index)) return true;
  return false;
}

/**
 * Reference and footnote definitions are refused anywhere in this file (round 13).
 *
 * Round 12 read markdown-it's env.references, but markdown-it records a definition only
 * when its destination validates: `[^t]: javascript:x`, `data:`, `vbscript:`, `file:`, an
 * unclosed `<` or an empty body never reach it. cmark-gfm takes every one of them as a
 * footnote and swallows the lines after it — the whole inventory table, or every row after
 * the definition. So footnote definitions are found by SHAPE on the raw source, every line,
 * fenced blocks included (a definition in a fence is inert on GitHub, but the file has no
 * reason to hold one, and refusing it needs no proof that markdown-it and cmark-gfm agree
 * on where every fence ends). Without a definition a `[^t]` reference renders as plain text
 * on GitHub, so no footnote can render. Link reference definitions are refused too: an
 * accepted one is hidden by both renderers but serves nothing here, and a rejected one is
 * text to the gate and hidden on GitHub.
 */
export function definitionProblems(doc) {
  const problems = [];
  // cmark-gfm and markdown-it both end a line at a lone CR; a scan that splits on LF only
  // reads `a\r[^t]: x` as one harmless line (round 14). A lone CR is refused outright, and
  // the scan splits on every line ending. CRLF files render the same in both and pass.
  // cmark-gfm drops a byte-order mark at the start of the file before it reads blocks;
  // markdown-it and the line scans below keep it, so BOM + `<pre` on line 1 was a
  // paragraph to the gate and an HTML block swallowing the table on GitHub (round 16).
  if (doc.startsWith("\ufeff"))
    problems.push("the file starts with a byte-order mark (U+FEFF) — GitHub drops it before reading line 1 and the gate does not, so save the file without one");
  // GitHub's blob view strips YAML front matter (a `---` first line through the next
  // `---` or `...`) before cmark-gfm runs and shows it as a YAML table or an "Error in
  // user YAML" box; the gate and markdown-it read the same `---` as a thematic break. So a
  // file opened with `---` could show the inventory as raw YAML on GitHub (round 17).
  if (/^---[ \t\f\v]*(?:\r\n|\r|\n|$)/.test(doc))
    problems.push("the file's first line is `---`, which GitHub reads as the start of YAML front matter and renders outside markdown — start the file with its heading");
  const cr = doc.search(/\r(?!\n)/);
  if (cr >= 0)
    problems.push(`line ${doc.slice(0, cr).split(/\r\n|\r|\n/).length} holds a carriage return that is not part of a CRLF — GitHub ends the line there, so write a real line break or remove it`);
  const lines = doc.split(/\r\n|\r|\n/);
  for (const [i, line] of lines.entries()) {
    if (FOOTNOTE_DEF_LINE.test(line))
      problems.push(`line ${i + 1} is a footnote definition ("${line.trim().slice(0, 40)}") — GitHub would swallow the lines after it, so write it as text`);
    // cmark-gfm and markdown-it keep different lists of the tag names that open an HTML
    // block (`<source` opens one on GitHub and is a paragraph to markdown-it 14), and an
    // open HTML block swallows every line up to the next blank — the inventory table
    // included (round 15). No line may start with `<` except the two markers themselves.
    else if (HTML_START_LINE.test(line) && line !== BEGIN && line !== END)
      problems.push(`line ${i + 1} starts with "<" ("${line.trim().slice(0, 40)}") — GitHub may open an HTML block there and hide the lines after it, so write it as text or in a code span`);
    else if (line !== BEGIN && line !== END && rawLtOutsideSimpleCode(line))
      problems.push(`line ${i + 1} has "<" outside a one-backtick code span on one line ("${line.trim().slice(0, 40)}") — the renderers disagree on longer code spans, so write it as \`<…>\` or reword it`);
  }
  const env = {};
  const tokens = new MarkdownIt({ html: true }).parse(doc, env);
  // markdown-it stops tokenizing a block once it is nested maxNesting (100) deep, and
  // drops what is inside it without a word; cmark-gfm has no such limit. So a tag in a
  // 100-deep blockquote was never read by the `<` check below, while GitHub emitted it
  // raw and a `<select>` swallowed the inventory (round 20). This file nests 4 deep; any
  // block past MAX_DEPTH is refused, which also covers every depth markdown-it would skip,
  // since the opening tokens of each level below the limit are still emitted.
  // One table in the file, the inventory (round 21): markdown-it ends a table early once
  // it has auto-filled 65536 empty cells while cmark-gfm keeps going, so the lines after
  // a big enough table are text to the gate and table cells on GitHub.
  const tables = tokens.filter((t) => t.type === "table_open").length;
  if (tables > 1)
    problems.push(`the file holds ${tables} tables — only the inventory may be a table, because the renderers disagree on where a large one ends`);
  const deepest = tokens.reduce((d, t) => Math.max(d, t.level), 0);
  if (deepest > MAX_DEPTH)
    problems.push(`the file nests blocks ${deepest} deep (limit ${MAX_DEPTH}) — past markdown-it's nesting limit it stops reading what GitHub still renders, so flatten the quotes or lists`);
  // Every accepted key, `^` ones included: `[\n^x]: url` is a link definition whose label
  // only LOOKS like a footnote's, and no single line of it matches the shape scan (round 15).
  const accepted = Object.keys(env.references ?? {});
  if (accepted.length)
    problems.push(`the file defines link reference(s) ${accepted.map((k) => `[${k}]`).join(", ")} — write the link inline`);
  // markdown-it gives an inline token inside a table cell no line map, so the line is the
  // nearest enclosing block's (round 19: a `[ref]:` row crashed the gate on `t.map[0]`).
  let line = 0;
  for (const t of tokens) {
    if (t.map) line = t.map[0] + 1;
    if (t.type === "inline" && REJECTED_REF_DEF.test(t.content) && !FOOTNOTE_DEF_LINE.test(t.content))
      problems.push(`line ${line} reads as a link reference definition ("${t.content.slice(0, 40)}") — GitHub hides it, the gate shows it, so write it as text`);
    // Raw HTML anywhere outside code (round 19). Rounds 2, 3 and 5 each closed one place
    // a tag could hide or cut the inventory — a line start, line 1 after a BOM, a table
    // cell — and each time the next placement over was open: a `<select>`, `<details>`,
    // `<noscript>`, `<template>` or `<table>` mid-line in prose swallows or hides the
    // table once a browser parses the page. So no `<` may appear anywhere in the rendered
    // text: only inside a code span or a fenced/indented code block, or as one of the two
    // inventory markers. An entity (`&lt;`) or an escape (`\<`) is refused too, because
    // the check reads what markdown-it decodes, and that over-refusal is fail-closed. An
    // HTML block needs no check here: it starts a line, and the line scan above refuses that.
    // The line of the `<` itself, not of the paragraph it sits in: the source offset of
    // the first `<`, entity or escape for one, in the inline token's own text.
    // (skipping a `<` that sits in a one-backtick code span, round 21).
    const offset = t.type === "inline" ? t.content.split("\n").findIndex((l) => rawLtOutsideSimpleCode(l)) : -1;
    const ltLine = offset < 0 ? line : line + offset;
    for (const c of t.type === "inline" ? t.children : [])
      if (c.type !== "code_inline" && c.content.includes("<"))
        problems.push(`line ${ltLine} has "<" outside a code span ("${c.content.trim().slice(0, 40)}") — raw HTML in prose can hide or cut the inventory in the browser, so put it in backticks or reword it`);
  }
  return problems;
}

const HEADER_ROW = /^\|\s*Surface\s*\|\s*File\s*\|\s*Status\s*\|\s*Placement\s*\|\s*Shows\s*\|$/;
const DELIMITER_ROW = /^\|(?:\s*:?-{3,}:?\s*\|){5}$/;

/**
 * The inventory block must be exactly: the begin marker, the header row, the delimiter
 * row, page rows, the end marker — nothing else on any line (round 14). markdown-it and
 * cmark-gfm disagree on where a table ends at a line that is not a row: a line holding
 * only `|` (or ` |`, `|\t`) is an empty row to markdown-it but ends the table on GitHub,
 * which then shows every row after it as text while both parsers here count it as listed.
 * Any other line (prose, a blank, a comment) would at best add a junk row. Allowing only
 * well-formed page rows leaves no line whose meaning the two renderers could disagree on.
 */
export function blockProblems(doc) {
  const b = doc.indexOf(BEGIN);
  const e = doc.indexOf(END);
  if (b < 0 || e < 0 || e < b) return [];
  const startLine = doc.slice(0, b).split(/\r\n|\r|\n/).length;
  const lines = doc.slice(b + BEGIN.length, e).split(/\r\n|\r|\n/);
  const problems = [];
  const at = (i) => `line ${startLine + i}`;
  if (lines[0].trim() !== "") problems.push(`${at(0)}: text after ${BEGIN} on the same line`);
  if (lines.at(-1) !== "") problems.push(`${END} must start its own line`);
  const body = lines.slice(1, -1);
  if (!HEADER_ROW.test(body[0] ?? "")) problems.push(`${at(1)}: the line after ${BEGIN} must be the header row "| Surface | File | Status | Placement | Shows |"`);
  if (!DELIMITER_ROW.test(body[1] ?? "")) problems.push(`${at(2)}: the line after the header must be the delimiter row "| --- | --- | --- | --- | --- |"`);
  for (const [i, line] of body.slice(2).entries()) {
    const cells = line.startsWith("|") && line.endsWith("|") ? line.split("|").slice(1, -1) : [];
    if (cells.length !== 5 || !/^`[^`]+`$/.test(cells[1].trim()))
      problems.push(`${at(i + 3)}: "${line.slice(0, 40)}" is not a page row (| surface | \`file\` | status | placement | shows |) — every line between the header and ${END} must be one, or GitHub may end the table there`);
    // Raw HTML inside a cell passes through cmark-gfm untouched, and a browser's HTML5
    // parser then obeys it: one `</table>` in a cell ends the table there, and every row
    // after it shows as run-on text while both parsers here still count it (round 18).
    // A page row may hold no `<` at all, in code spans included; write it as text.
    else if (line.includes("<"))
      problems.push(`${at(i + 3)}: a page row contains "<" — raw HTML in a cell can end the table in the browser, so describe the screen without it`);
  }
  return problems;
}

/**
 * The page files the inventory table SHOWS when rendered: the File cell of every body row
 * of every table between the begin/end markers, in order. parseRows reads source lines
 * that start with `|`; a blank line, a comment or any other line between two rows ends the
 * rendered table, so the rows after it are listed in the source and shown as text on
 * GitHub (round 13: "45 page files listed" while GitHub showed 2). The two must agree.
 */
export function renderedInventory(doc) {
  const b = doc.indexOf(BEGIN);
  const e = doc.indexOf(END);
  if (b < 0 || e < 0 || e < b) return { tables: 0, files: [] };
  const lineOf = (offset) => doc.slice(0, offset).split("\n").length - 1;
  const [from, to] = [lineOf(b), lineOf(e)];
  const tokens = new MarkdownIt({ html: true }).parse(doc, {});
  let tables = 0;
  const files = [];
  let inBody = false;
  let cell = 0;
  for (const [i, t] of tokens.entries()) {
    if (t.type === "table_open" && t.map[0] > from && t.map[0] < to) tables += 1;
    else if (t.type === "tbody_open") inBody = t.map[0] > from && t.map[0] < to;
    else if (t.type === "tbody_close") inBody = false;
    else if (inBody && t.type === "tr_open") cell = 0;
    else if (inBody && t.type === "td_open" && ++cell === 2) {
      const file = /^`([^`]+)`$/.exec(tokens[i + 1]?.content.trim() ?? "")?.[1];
      if (file) files.push(file);
    }
  }
  return { tables, files };
}

// The demo section's allow-list (round 11): constructs markdown-it and GitHub's
// cmark-gfm render the same way. The section's own heading is skipped.
const BLOCKS_OK = new Set(["paragraph_open", "paragraph_close", "ordered_list_open", "ordered_list_close",
  "list_item_open", "list_item_close", "inline"]);
const INLINE_OK = new Set(["text", "code_inline", "softbreak", "strong_open", "strong_close", "em_open", "em_close"]);

// Elements whose content a browser never shows as text.
const UNSHOWN = new Set(["script", "style", "template", "noscript", "head", "title"]);
const isHidden = (node) => (node.attrs ?? []).some(({ name, value }) =>
  name === "hidden" || (name === "style" && /(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))/i.test(value)));

/** Text of a parse5 tree as a browser shows it. Comment nodes are dropped by node type. */
export function visibleText(node) {
  if (node.nodeName === "#text") return node.value;
  if (node.nodeName === "#comment" || node.nodeName === "#documentType") return "";
  if (node.tagName && (UNSHOWN.has(node.tagName) || isHidden(node))) return "";
  if (node.tagName === "br") return "\n";
  return (node.childNodes ?? []).map(visibleText).join("");
}

/** Rows of the inventory table: [{ surface, file, status, placement, shows, line }]. */
export function parseRows(doc) {
  const b = doc.indexOf(BEGIN);
  const e = doc.indexOf(END);
  if (b < 0 || e < 0 || e < b) return null;
  const rows = [];
  const lines = doc.slice(b, e).split("\n");
  for (const [i, line] of lines.entries()) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    const file = /^`([^`]+)`$/.exec(cells[1] ?? "")?.[1];
    if (!file) continue; // header / separator
    rows.push({ surface: cells[0], file, status: cells[2], placement: cells[3], shows: cells[4] ?? "", line: i });
  }
  return rows;
}

/** Pure check. Returns a list of failure strings; empty means green. */
export function check({ doc, pageFiles, statuses, placements, unparsedRoutes = [], profileVersion }) {
  const errors = unparsedRoutes.map((u) => `${ADMIN_ROUTES}: ${u} — teach scripts/check-screen-inventory.mjs the shape or rewrite the route`);
  const rows = parseRows(doc);
  if (!rows) return [`${DOC} has no ${BEGIN} … ${END} block`];
  for (const p of definitionProblems(doc)) errors.push(`${DOC}: ${p}`);
  for (const p of blockProblems(doc)) errors.push(`${DOC}: ${p}`);
  const shown = renderedInventory(doc);
  if (shown.tables !== 1)
    errors.push(`${DOC}: the inventory block renders ${shown.tables} tables — it must be one table, every row adjacent`);
  if (shown.files.join("\n") !== rows.map((r) => r.file).join("\n"))
    errors.push(`${DOC}: the inventory table renders ${shown.files.length} page rows but ${rows.length} are listed in the source — a line between two rows ends the table, and the rows after it render as text`);
  const vm = /launch profile v(\d+)/i.exec(doc);
  if (!vm) errors.push(`${DOC} does not name the launch-profile version it was checked against ("launch profile vN")`);
  else if (Number(vm[1]) !== profileVersion)
    errors.push(`${DOC} says launch profile v${vm[1]}; scripts/launch-profile.mjs is v${profileVersion} — re-read every status`);
  // The demo path's step 4 is prose, but a defect in it already shipped (it named no
  // credential, so the shell decided on-device). The shell reaches the api-server only
  // with ALL of these (DecisionServiceProvider.resolve needs a URL and a token;
  // DemoMode.backendURL returns nil for any host that is not loopback; the refs must be
  // the seeded ones or the decision is fail-closed), so every one is gated, and every
  // URL step 4 gives must be loopback.
  const { text: step4, problems: step4Problems } = renderedStep4(doc);
  for (const p of step4Problems) errors.push(`${DOC}: ${p}`);
  if (step4 === null) errors.push(`${DOC}: demo path step 4 not found`);
  else {
    for (const [flag, want] of Object.entries(STEP4_FLAGS)) {
      const esc = flag.replace(/[\\^$.*+?()[\]{}|\/-]/g, "\\$&"); // every regex metacharacter, backslash included
      const uses = [...step4.matchAll(new RegExp(`(?<![\\w-])${esc}(?![\\w-])(?:[ \\t]+([^ \\t\\n]+))?`, "g"))];
      if (uses.length === 0) {
        errors.push(`${DOC}: demo step 4 no longer names ${flag} — without it the host app decides on-device or in another tenant`);
        continue;
      }
      // EVERY use of the flag in the rendered text must carry the right value, so a
      // second, wrong occurrence cannot hide behind a right one. The value is the
      // whole argument up to ASCII space, tab or newline — what the shell splits
      // arguments on. A Unicode space (round 6), `,x` / `)x` / `;x` (round 5) and any
      // text a code span boundary used to hide (round 7) stay part of it, because the
      // rendered text has no code-span boundaries left to hide behind.
      for (const [, value] of uses) {
        if (!value) {
          errors.push(`${DOC}: demo step 4 names ${flag} with no value after it — write "${flag} ${want ?? "http://127.0.0.1:8080"}"`);
        } else if (want !== null && value !== want) {
          errors.push(`${DOC}: demo step 4 gives ${flag} ${value}; the seeded demo needs ${flag} ${want}`);
        } else if (want === null) {
          const problem = urlProblem(value);
          if (problem) errors.push(`${DOC}: demo step 4 gives -DemoBackendURL ${value} — ${problem}; DemoMode.backendURL would return nil and the shell would decide on-device`);
        }
      }
    }
  }
  const tracked = new Set(pageFiles);
  const seen = new Map();
  for (const r of rows) {
    seen.set(r.file, (seen.get(r.file) ?? 0) + 1);
    if (!tracked.has(r.file)) {
      errors.push(`listed page is not a tracked page file (deleted or renamed?): ${r.file}`);
      continue;
    }
    const dir = PAGE_RE.exec(r.file)[1];
    if (r.surface !== dir) errors.push(`${r.file}: surface column says "${r.surface}", the file is under artifacts/${dir}`);
    const want = statuses.get(dir);
    if (!want) errors.push(`${r.file}: surface ${dir} is not classified in scripts/launch-profile.mjs app-surfaces`);
    const wantPlacement = dir === ADMIN ? (placements.get(adminPageKey(r.file)) ?? "not routed") : "—";
    const wantStatus = want && dir === ADMIN && wantPlacement !== "launch route" ? `${want} surface · not a launch screen` : want;
    if (want && r.status !== wantStatus)
      errors.push(`${r.file}: status column says "${r.status}", expected "${wantStatus}" (launch-profile.mjs says "${want}" for ${dir})`);
    if (r.placement !== wantPlacement)
      errors.push(`${r.file}: placement column says "${r.placement}", ${dir === ADMIN ? ADMIN_ROUTES : "non-admin surface"} gives "${wantPlacement}"`);
    if (!r.shows || r.shows === "—") errors.push(`${r.file}: "shows" column is empty — say what the screen shows`);
    else if (/^(tbd|todo|tk|xxx|fixme|n\/?a|\?+|\.\.\.|…)$/i.test(r.shows))
      errors.push(`${r.file}: "shows" column is a placeholder ("${r.shows}") — say what the screen shows`);
  }
  for (const [f, n] of seen) if (n > 1) errors.push(`${f} is listed ${n} times`);
  for (const f of pageFiles) if (!seen.has(f)) errors.push(`page file missing from ${DOC}: ${f}`);
  return errors;
}

function trackedPages() {
  const out = execFileSync("git", ["ls-files", "-z", "--", "artifacts/*/src/pages/*.tsx", "artifacts/*/src/pages/**/*.tsx"], { encoding: "utf8" });
  return [...new Set(out.split("\0").filter((f) => PAGE_RE.test(f)))].sort();
}

function selfTest() {
  const statuses = new Map([["signalgrid-app", "launch"], ["signalgrid-web", "demo_only"]]);
  // A real TSX module, shaped like App.tsx: routes are JSX elements inside a component.
  const ROUTES = [
    '        {/* <Route path="/x" component={Orphan} /> */}',
    '        <Route path="/sessions" component={SessionList} />',
    '        <Route path="/fleet" component={FleetPreview} />',
    "        <Route component={NotFound} />",
  ];
  const appSrc = [
    'import NotFound from "@/pages/not-found";',
    'const DecisionList = named(() => import("@/pages/decisions/DecisionList"), "DecisionList");',
    "const SessionList = DecisionList;",
    'const Fleet = named(() => import("@/pages/Fleet"), "Fleet");',
    'const Orphan = named(() => import("@/pages/Orphan"), "Orphan");',
    "const FleetPreview = preview(Fleet);",
    "export function Router() {",
    "  return (",
    "    <Layout>",
    "      <Switch>",
    ...ROUTES,
    "      </Switch>",
    "    </Layout>",
    "  );",
    "}",
    "",
  ].join("\n");
  const { placement: placements, unparsed } = adminPlacements(appSrc);
  const pageFiles = [
    "artifacts/signalgrid-app/src/pages/Fleet.tsx",
    "artifacts/signalgrid-app/src/pages/Orphan.tsx",
    "artifacts/signalgrid-app/src/pages/decisions/DecisionList.tsx",
    "artifacts/signalgrid-app/src/pages/not-found.tsx",
    "artifacts/signalgrid-web/src/pages/Home.tsx",
  ];
  const row = (s, f, st, p, sh = "a screen") => `| ${s} | \`${f}\` | ${st} | ${p} | ${sh} |`;
  // Step 4 as the real doc writes it: the four launch arguments in a fenced block,
  // one per line, inside list item 4.
  const ARGS = {
    "-DemoBackendIdentity": "nurse.compliant",
    "-DemoBackendDevice": "ipad-ward-01",
    "-DemoBackendURL": "http://127.0.0.1:8080",
    "-DemoBackendToken": "sgk_demo_northwind_operator",
  };
  const fence = (args) => ["   ```", ...Object.entries(args).filter(([, v]) => v !== undefined).map(([f, v]) => `   ${f}${v === "" ? "" : ` ${v}`}`), "   ```"].join("\n");
  const step4 = (args = ARGS, prose = "") => `4. host app:\n\n${fence(args)}\n${prose ? `\n   ${prose}\n` : ""}`;
  const STEP4 = step4();
  const good = [
    "Checked against launch profile v7.",
    BEGIN,
    "| Surface | File | Status | Placement | Shows |",
    "| --- | --- | --- | --- | --- |",
    row("signalgrid-app", pageFiles[0], "launch surface · not a launch screen", PREVIEW),
    row("signalgrid-app", pageFiles[1], "launch surface · not a launch screen", "not routed"),
    row("signalgrid-app", pageFiles[2], "launch", "launch route"),
    row("signalgrid-app", pageFiles[3], "launch surface · not a launch screen", "404 fallback"),
    row("signalgrid-web", pageFiles[4], "demo_only", "—"),
    END,
    "## The demo path",
    STEP4,
    "5. audit",
  ].join("\n");
  const INV_ROW = row("signalgrid-app", pageFiles[2], "launch", "launch route");
  const base = { doc: good, pageFiles, statuses, placements, unparsedRoutes: unparsed, profileVersion: 7 };
  const withArg = (flag, value, prose = "") => ({ ...base, doc: good.replace(STEP4, step4({ ...ARGS, [flag]: value }, prose)) });
  const withProse = (prose) => ({ ...base, doc: good.replace(STEP4, step4(ARGS, prose)) });
  // Swap one route line of the fixture; optionally edit the doc too. Returns check() input.
  const SESSIONS = ROUTES[1].trim();
  const FLEET = ROUTES[2].trim();
  const routeCase = (from, to, docEdit = (d) => d, extra = "") => {
    const r = adminPlacements(appSrc.replace(from, to) + extra);
    return { ...base, doc: docEdit(good), placements: r.placement, unparsedRoutes: r.unparsed };
  };
  const asNotRouted = (d) => d.replace("| launch | launch route |", "| launch surface · not a launch screen | not routed |");
  const cases = [
    ["clean fixture passes", base, null],
    ["a page file missing from the doc fails", { ...base, pageFiles: [...pageFiles, "artifacts/signalgrid-web/src/pages/New.tsx"] }, "missing from"],
    ["a listed file that is gone fails", { ...base, pageFiles: pageFiles.slice(0, 4) }, "not a tracked page file"],
    ["a status disagreeing with launch-profile fails", { ...base, doc: good.replace("| demo_only |", "| launch |") }, "status column"],
    ["a status of an unclassified surface fails", { ...base, statuses: new Map([["signalgrid-app", "launch"]]) }, "not classified"],
    ["a wrong admin placement fails", { ...base, doc: good.replace(`| ${PREVIEW} |`, "| launch route |") }, "placement column"],
    ["a preview page whose status reads plain 'launch' fails", { ...base, doc: good.replace("| launch surface · not a launch screen | preview", "| launch | preview") }, "status column"],
    // Each route case changes the doc to what a fooled parser would conclude, so only a
    // correct parse can make it fail.
    ["an inline-arrow <Route> fails even when the row says 'not routed'", routeCase(FLEET, '<Route path="/fleet" component={() => <Fleet />} />', (d) => d.replace(`| ${PREVIEW} |`, "| not routed |")), "unrecognised <Route> shape"],
    ["a <Route> naming no known page fails", routeCase(FLEET, '<Route path="/fleet" component={SomethingElse} />'), "resolves to no page"],
    ["a <Route> with children fails", routeCase(FLEET, '<Route path="/fleet"><FleetPreview /></Route>'), "has children"],
    ["a <Route> with a spread fails", routeCase(FLEET, '<Route path="/fleet" component={FleetPreview} {...rest} />'), "unrecognised <Route> shape"],
    ["a commented-out route does not count as routed", { ...base, doc: good.replace("| not routed |", "| launch route |") }, "placement column"],
    ['a {"//"} expression before a <Route> does not hide it', routeCase(SESSIONS, `{"//"}${SESSIONS}`, asNotRouted), "placement column"],
    ["JSX text with // before a <Route> does not hide it (round 3)", routeCase(SESSIONS, `see https://x ${SESSIONS}`, asNotRouted), "placement column"],
    ["an apostrophe in JSX text does not hide the routes after it", routeCase(SESSIONS, `<p>don't</p>\n${SESSIONS}`), null],
    ["<Route> text only in a template literal is not a route (round 3)", routeCase(SESSIONS, "", (d) => d, `\nexport const EXAMPLE = \`${SESSIONS}\`;\n`), "placement column"],
    ["<Route> text only in a quoted string is not a route (round 3)", routeCase(SESSIONS, "", (d) => d, `\nexport const EXAMPLE = '${SESSIONS}';\n`), "placement column"],
    ["an App.tsx that does not parse fails", routeCase("export function Router() {", "export function Router( {"), "does not parse"],
    ["an empty shows column fails", { ...base, doc: good.replace("| — | a screen |", "| — |  |") }, "empty"],
    ["a placeholder shows column (TBD) fails", { ...base, doc: good.replace("| — | a screen |", "| — | TBD |") }, "placeholder"],
    // Demo step 4 — read as rendered text. `withArg` edits one line of the fenced block;
    // `withProse` adds a paragraph to the same list item.
    ...Object.keys(ARGS).map((flag) =>
      [`demo step 4 without ${flag} fails (round 3)`, withArg(flag, undefined), `no longer names ${flag}`]),
    ["demo step 4 with a non-loopback URL fails (round 3)", withArg("-DemoBackendURL", "https://api.example.com"), "loopback only"],
    ["demo step 4 with a flag but no value fails", withArg("-DemoBackendURL", ""), "no value after it"],
    ...["http://localhost:8080", "http://[::1]:8080", "http://127.0.0.1:8080/api", "HTTP://LOCALHOST:8080"].map((url) =>
      [`demo step 4 with ${url} passes`, withArg("-DemoBackendURL", url), null]),
    // Round 4.
    ["port + userinfo before a foreign host fails (round 4)", withArg("-DemoBackendURL", "http://127.0.0.1:8080@api.example.com"), "userinfo"],
    ["localhost:pw@ before a foreign host fails (round 4)", withArg("-DemoBackendURL", "http://localhost:pw@api.example.com"), "userinfo"],
    ["a non-http scheme fails even with a loopback URL in the prose (round 4)", withArg("-DemoBackendURL", "ftp://evil.com", "(never http://127.0.0.1:8080)"), "scheme is ftp:"],
    ["[::1].evil.com fails (round 4)", withArg("-DemoBackendURL", "http://[::1].evil.com"), "not a URL"],
    ["a lookalike identity fails (round 4)", withArg("-DemoBackendIdentity", "nurse.compliantX"), "gives -DemoBackendIdentity nurse.compliantX"],
    ["another tenant's token beside a mention of the right one fails (round 4)", withArg("-DemoBackendToken", "sgk_demo_acme_operator", "(not sgk_demo_northwind_operator)"), "gives -DemoBackendToken sgk_demo_acme_operator"],
    ["a second, wrong use of a flag fails even beside a right one (round 4)", withProse("or `-DemoBackendURL https://api.example.com`"), "its host is api.example.com"],
    // Round 5: WHATWG calls each of these loopback; the shell's literal host does not.
    ...[["http:127.0.0.1:8080", "slash-less"], ["http://127.1:8080", "shorthand"], ["http://0177.0.0.1:8080", "octal"],
      ["http://2130706433:8080", "integer"], ["http://0x7f.1:8080", "hex"], ["http://[0:0:0:0:0:0:0:1]:8080", "long-form IPv6"],
      ["http://127.0.0.1\\@evil.com", "backslash"], ["http://127.0.0.1,@evil.com", "comma-userinfo"]].map(([url, kind]) =>
      [`a ${kind} loopback URL fails (round 5)`, withArg("-DemoBackendURL", url), `-DemoBackendURL ${url} —`]),
    ...[",x", ")x", ";x"].map((tail) =>
      [`a token with ${tail} appended fails (round 5)`, withArg("-DemoBackendToken", `sgk_demo_northwind_operator${tail}`), `gives -DemoBackendToken sgk_demo_northwind_operator${tail}`]),
    ["an identity with ;x appended fails (round 5)", withArg("-DemoBackendIdentity", "nurse.compliant;x"), "gives -DemoBackendIdentity nurse.compliant;x"],
    // Round 6: a Unicode space is part of the shell argument; port 0 serves nothing.
    ...[["\u00a0", "NBSP"], ["\ufeff", "U+FEFF"], ["\u2028", "U+2028"], ["\u3000", "U+3000"]].map(([ch, name]) =>
      [`a URL with ${name} inside fails (round 6)`, withArg("-DemoBackendURL", `http://127.0.0.1${ch}@evil.com`), "-DemoBackendURL http://127.0.0.1"]),
    ["a token with NBSP+x appended fails (round 6)", withArg("-DemoBackendToken", "sgk_demo_northwind_operator\u00a0x"), "gives -DemoBackendToken sgk_demo_northwind_operator\u00a0x"],
    ["an identity with U+202F+x appended fails (round 6)", withArg("-DemoBackendIdentity", "nurse.compliant\u202fx"), "gives -DemoBackendIdentity nurse.compliant\u202fx"],
    ["a code span closed mid-token fails (round 6)", withProse("-DemoBackendToken `sgk_demo_northwind_operator`x"), "gives -DemoBackendToken sgk_demo_northwind_operatorx"],
    ["port 0 fails (round 6)", withArg("-DemoBackendURL", "http://127.0.0.1:0"), "its port is 0"],
    ["port 00 fails (round 6)", withArg("-DemoBackendURL", "http://127.0.0.1:00"), "its port is 0"],
    // Round 7: the gate reads what renders, so markdown cannot make the source and the
    // copied text disagree.
    ["a backtick that OPENS a span before ,@evil.com fails (round 7)", withProse("-DemoBackendURL http://127.0.0.1`,@evil.com`"), "-DemoBackendURL http://127.0.0.1,@evil.com —"],
    ["a token with an opened `,x` span fails (round 7)", withProse("-DemoBackendToken sgk_demo_northwind_operator`,x`"), "gives -DemoBackendToken sgk_demo_northwind_operator,x"],
    ["a double-backtick span with an inner backtick fails (round 7)", withProse("``-DemoBackendToken sgk_demo_northwind_operator`,x``"), "gives -DemoBackendToken sgk_demo_northwind_operator`,x"],
    ["a flag only inside an HTML comment does not count (round 7)", withArg("-DemoBackendToken", undefined, "<!-- -DemoBackendToken sgk_demo_northwind_operator -->"), "no longer names -DemoBackendToken"],
    ["an entity-encoded flag is read as rendered (round 7)", withProse("<!-- x --> &#45;DemoBackendURL https://api.example.com"), "its host is api.example.com"],
    // CodeQL follow-up: comments and tags are stripped as a browser hides them.
    ["a flag only after an unclosed <!-- does not count", withArg("-DemoBackendToken", undefined, "<!-- -DemoBackendToken sgk_demo_northwind_operator"), "no longer names -DemoBackendToken"],
    ["a malformed comment opener is raw HTML and is refused", withArg("-DemoBackendToken", undefined, "<!<!---->-- -DemoBackendToken sgk_demo_northwind_operator -->"), "raw HTML"],
    ["…and the value after it is still checked", withArg("-DemoBackendToken", undefined, "<!<!---->-- -DemoBackendToken sgk_demo_acme_operator -->"), "gives -DemoBackendToken sgk_demo_acme_operator"],
    ["`<-DemoBackendURL …>` is visible text and is checked", withProse("<p>x</p> <-DemoBackendURL https://api.example.com >"), "its host is api.example.com"],
    // Round 8: HTML is read by an HTML5 parser, as a browser shows it — and refused.
    ["any raw HTML in the demo section fails, even a harmless comment (round 8)", withProse("<!-- note -->"), "raw HTML"],
    ["textarea (RCDATA) text is shown, so its URL is checked (round 8)", withProse("<textarea><b -DemoBackendURL https://evil.example.com></textarea>"), "gives -DemoBackendURL https://evil.example.com>"],
    ["text after <!--> is shown (round 8)", withProse("<!--> -DemoBackendURL https://evil.example.com -->"), "its host is evil.example.com"],
    ["text after --!> is shown (round 8)", withProse("<!-- a --!> -DemoBackendURL https://evil.example.com -->"), "its host is evil.example.com"],
    ["text between non-tag < … > in a <div> is shown (round 8)", withProse("<div>1 < -DemoBackendURL https://evil.example.com > 2</div>"), "its host is evil.example.com"],
    ...[["<span hidden>", "</span>", "a hidden span"], ['<span style="display: none">', "</span>", "a display:none span"],
      ["<style>", "</style>", "a <style> element"], ["<script>", "</script>", "a <script> element"], ["<?x ", " ?>", "a processing instruction"]].map(([o, c, what]) =>
      [`a token only inside ${what} does not count (round 8)`, withArg("-DemoBackendToken", undefined, `${o}-DemoBackendToken sgk_demo_northwind_operator${c}`), "no longer names -DemoBackendToken"]),
    ["an image in step 4 fails (round 8)", withProse("![-DemoBackendToken sgk_demo_northwind_operator](x.png)"), "contains an image"],
    ["a second demo-path section fails (round 8)", { ...base, doc: `${good}\n\n## The demo path again\n\n4. -DemoBackendURL https://evil.example.com\n` }, "sections"],
    ["a second item numbered 4 fails (round 8)", { ...base, doc: good.replace("5. audit", "5. audit\n\n   4. -DemoBackendURL http://127.0.0.1:8080") }, "numbered 4"],
    ["a 4. under a later h2 is not step 4 (round 8)", { ...base, doc: `${good}\n\n## Elsewhere\n\n4. unrelated\n` }, null],
    // Round 9: a heading nested in step 4 does not end the section, and step 4 is the
    // item a reader sees as 4, not the one whose source marker says 4.
    ...[["   ## Note", "a nested h2"], ["   # Note", "a nested h1"], ["   Note\n   ====", "a nested setext heading"], ["   > ## Note", "a heading in a blockquote"]].map(([h, what]) =>
      [`${what} in step 4 does not hide the text after it (round 9)`, withProse(`x\n\n${h}\n\n   Use -DemoBackendURL https://evil.example.com`), "its host is evil.example.com"]),
    ["a heading carrying a wrong flag in step 4 is checked (round 9)", withProse("x\n\n   ## Use -DemoBackendDevice ipad-evil"), "gives -DemoBackendDevice ipad-evil"],
    ["a repeated marker that renders as step 4 fails (round 9)", { ...base, doc: good.replace(STEP4, `4. -DemoBackendURL https://evil.example.com\n${STEP4}`) }, 'written "4." renders as 5'],
    // `3. 3. 4.`: the second `3.` is what a reader sees as step 4, the real one shows as 5.
    ["…and the item that renders as 4 is the one checked (round 9)", { ...base, doc: good.replace(STEP4, `3. intro\n3. -DemoBackendURL https://evil.example.com\n${STEP4}`) }, "its host is evil.example.com"],
    // Round 10: syntax GitHub renders differently from markdown-it is refused.
    ["a footnote definition carrying a flag fails (round 10)", withArg("-DemoBackendToken", undefined, "[^t]: -DemoBackendToken sgk_demo_northwind_operator"), "footnote syntax"],
    ["a referenced footnote fails (round 10)", withProse("See the token[^t].\n\n   [^t]: -DemoBackendToken sgk_demo_northwind_operator"), "footnote syntax"],
    ["$ math in the demo section fails (round 10)", withProse("$-DemoBackendDevice ipad-ward-01$"), "contains `$`"],
    ["an escaped 4\\. paragraph that reads as a step fails (round 10)", { ...base, doc: good.replace(STEP4, `4\\. **The host app** Launch with -DemoBackendURL https://evil.example.com\n\n${STEP4}`) }, "reads as a numbered step"],
    ["an entity-spelled 4&#46; paragraph fails (round 10)", { ...base, doc: good.replace(STEP4, `4&#46; fake step\n\n${STEP4}`) }, "reads as a numbered step"],
    ["a heading that reads as a step fails (round 10)", { ...base, doc: good.replace(STEP4, `### 4. fake step\n\n${STEP4}`) }, "reads as a numbered step"],
    // Round 11: the section is held to an allow-list, so a renderer disagreement fails
    // by default; the numbered-line check reads every rendered line, in any script.
    ...["math", "mermaid", "geojson", "topojson", "stl"].map((lang) =>
      [`a \`\`\`${lang} fence in step 4 fails (round 11)`, { ...base, doc: good.replace("   ```\n   -DemoBackendIdentity", `   \`\`\`${lang}\n   -DemoBackendIdentity`) }, `info "${lang}"`]),
    ["a ~~~math fence fails (round 11)", { ...base, doc: good.replace(STEP4, STEP4.replace(/```/g, "~~~").replace("~~~\n   -Demo", "~~~math\n   -Demo")) }, 'info "math"'],
    ["a sh fence passes (round 11)", { ...base, doc: good.replace("   ```\n   -DemoBackendIdentity", "   ```sh\n   -DemoBackendIdentity") }, null],
    ["a hard break fails (round 11)", withProse("first line\\\n   second line"), "renders as hardbreak"],
    ["a link fails (round 11)", withProse("[the console](https://example.com)"), "renders as link"],
    ["a blockquote fails (round 11)", withProse("> quoted"), "renders as blockquote"],
    ["a bare URL in prose fails (round 11)", withProse("see http://127.0.0.1:8080\\"), "bare URL"],
    ...[["   x  \n   4\\. fake", "a line after a two-space hard break"], ["   x\n   Step 4. fake", "Step 4."], ["   \uff14. fake", "a full-width digit"],
      ["   4\u2024 fake", "a one-dot leader"], ["   \u248b fake", "a digit-full-stop character"], ["   \u0664. fake", "an Arabic-Indic digit"], ["   IV. fake", "a roman numeral"]].map(([line, what]) =>
      [`${what} that reads as a step fails (round 11)`, { ...base, doc: good.replace(STEP4, `${line.trimStart()}\n\n${STEP4}`) }, "reads as a numbered step"]),
    // Round 12: a footnote definition line is invisible to markdown-it's inline tokens
    // but swallows the following lines on GitHub.
    ...[["[^t]: x", "a footnote definition"], ['[^t]: x "title"', "one with a title"], ["[^1]: x", "a numeric label"], ["[^T]:x", "no space"],
      ["[^t]: http://127.0.0.1:8080", "a URL destination"]].map(([def, what]) =>
      [`${what} swallowing the argument lines fails (round 12)`, { ...base, doc: good.replace(STEP4, `4. host app:\n\n   ${def}\n${Object.entries(ARGS).map(([f, v]) => `   ${f} \`${v}\``).join("\n")}\n`) }, "is a footnote definition"]),
    ["the same argument lines without a definition pass (round 12 control)", { ...base, doc: good.replace(STEP4, `4. host app:\n\n${Object.entries(ARGS).map(([f, v]) => `   ${f} \`${v}\``).join("\n")}\n`) }, null],
    // Round 13: markdown-it records a definition only when its destination validates, so
    // definitions are found by shape on the raw source, and the rows the table RENDERS
    // must be the rows the source lists.
    ...["[^t]: javascript:x", "[^t]: data:text/html,x", "[^t]: vbscript:x", "[^t]: file:///etc", "[^t]: JAVASCRIPT:x",
      '[^t]: javascript:x "title"', "[^t]: <", "[^t]: <javascript:x>", "[^t]:", "> [^t]: javascript:x", "   [^t]: javascript:x",
      "- [^t]: javascript:x", "1. > [^t]: javascript:x"].map((def) =>
      [`an unrecorded footnote definition "${def}" after the begin marker fails (round 13)`, { ...base, doc: good.replace(BEGIN, `${BEGIN}\n${def}`) }, "is a footnote definition"]),
    ["an unrecorded footnote definition between two rows fails (round 13)", { ...base, doc: good.replace(INV_ROW, `[^t]: javascript:x\n${INV_ROW}`) }, "is a footnote definition"],
    ["a footnote rendered outside the demo section fails (round 13)", { ...base, doc: good.replace(END, `${END}\n\nSee[^t] here.\n\n[^t]: javascript:x\n    more\n`) }, "is a footnote definition"],
    ["a footnote definition before the demo heading fails (round 13)", { ...base, doc: good.replace("## The demo path", "[^t]: javascript:x\n\n## The demo path") }, "is a footnote definition"],
    ["a footnote definition inside a fenced block fails too (round 13)", { ...base, doc: good.replace(END, `${END}\n\n\`\`\`\n[^t]: x\n\`\`\`\n`) }, "is a footnote definition"],
    ["a [^t] reference with no definition passes outside the demo section (round 13)", { ...base, doc: good.replace(END, `${END}\n\nSee[^t] here.\n`) }, null],
    ["a link reference definition fails (round 13)", { ...base, doc: `${good}\n\n[t]: x\n` }, "defines link reference"],
    ["a link reference definition markdown-it rejects fails (round 13)", { ...base, doc: `${good}\n\n[t]: javascript:x\n` }, "reads as a link reference definition"],
    ["a rejected multi-line-label definition is not step-4 text (round 13)", withArg("-DemoBackendIdentity", undefined, "[x -DemoBackendIdentity nurse.compliant\n   ]: javascript:x"), "reads as a link reference definition"],
    ["a blank line between two rows fails (round 13)", { ...base, doc: good.replace(INV_ROW, `\n${INV_ROW}`) }, "renders 2 page rows but 5"],
    ["a comment between two rows fails (round 13)", { ...base, doc: good.replace(INV_ROW, `<!-- x -->\n${INV_ROW}`) }, "renders 2 page rows but 5"],
    ["a second table in the inventory block fails (round 13)", { ...base, doc: good.replace(INV_ROW, `\n| Surface | File | Status | Placement | Shows |\n| --- | --- | --- | --- | --- |\n${INV_ROW}`) }, "renders 2 tables"],
    // Round 14: a lone CR is a line end to both renderers, and the inventory block may hold
    // only page rows, so no line can end GitHub's table where markdown-it continues it.
    ...[["a\r[^t]: javascript:x\r", "after the begin marker"], ["\r[^t]: x", "CR-led after the begin marker"]].map(([x, where]) =>
      [`a lone-CR footnote definition ${where} fails (round 14)`, { ...base, doc: good.replace(BEGIN, `${BEGIN}\n${x}`) }, "carriage return"]),
    ["a lone-CR footnote definition appended to a row fails (round 14)", { ...base, doc: good.replace(INV_ROW, `${INV_ROW}\r[^t]: x`) }, "carriage return"],
    ["a lone-CR footnote outside the inventory fails (round 14)", { ...base, doc: good.replace(END, `${END}\n\nSee[^t] here.\r[^t]: real note\n`) }, "carriage return"],
    ["a lone-CR link reference definition fails (round 14)", { ...base, doc: `${good}\n\na\r[t]: javascript:x\n` }, "carriage return"],
    ["a whole-file CRLF doc passes (round 14)", { ...base, doc: good.replace(/\n/g, "\r\n") }, null],
    ...["|", " |", "|  ", "|\t"].map((line) =>
      [`a ${JSON.stringify(line)} line between two rows fails (round 14)`, { ...base, doc: good.replace(INV_ROW, `${line}\n${INV_ROW}`) }, "is not a page row"]),
    ["a \"|\" line right after the delimiter fails (round 14)", { ...base, doc: good.replace("| --- | --- | --- | --- | --- |\n", "| --- | --- | --- | --- | --- |\n|\n") }, "is not a page row"],
    ["a text line between two rows fails (round 14)", { ...base, doc: good.replace(INV_ROW, `hello\n${INV_ROW}`) }, "is not a page row"],
    ["a missing header row fails (round 14)", { ...base, doc: good.replace("| Surface | File | Status | Placement | Shows |\n", "") }, "must be the header row"],
    ["text after the begin marker on its line fails (round 14)", { ...base, doc: good.replace(BEGIN, `${BEGIN} x`) }, "text after"],
    ["a missing delimiter row fails (round 14)", { ...base, doc: good.replace("| --- | --- | --- | --- | --- |\n", "") }, "must be the delimiter row"],
    ["an end marker not on its own line fails (round 14)", { ...base, doc: good.replace(`\n${END}`, END) }, "must start its own line"],
    // Round 15: tag names that open an HTML block differ between the two renderers.
    ...["<source", "<source x y", "</source", "<SOURCE", "   <source", "> <source", "- <source"].map((x) =>
      [`a ${JSON.stringify(x)} line before the inventory fails (round 15)`, { ...base, doc: good.replace(BEGIN, `${x}\n${BEGIN}`) }, 'starts with "<"']),
    ["a \"<source\" line after the inventory fails (round 15)", { ...base, doc: good.replace(END, `${END}\n<source\n`) }, 'starts with "<"'],
    ["a link definition whose label starts with ^ on its second line fails (round 15)", { ...base, doc: `${good}\n\n[\n^x]: http://a\n` }, "defines link reference"],
    // Round 16: GitHub drops a leading BOM, so line 1 is read without it.
    ...["<pre", "<script", "<?php", ""].map((x) =>
      [`a leading byte-order mark${x ? ` before "${x}"` : ""} fails (round 16)`, { ...base, doc: `\ufeff${x}${x ? "\n" : ""}${good}` }, "byte-order mark"]),
    // Round 17: GitHub reads a `---` first line as YAML front matter.
    ...[["---\n", "---"], ["--- \n", "--- with a trailing space"], ["---\r\n", "--- in a CRLF file"], ["---", "--- alone"]].map(([x, what]) =>
      [`a first line of ${what} fails (round 17)`, { ...base, doc: `${x}${x.endsWith("\n") ? "" : "\n"}${good}` }, "YAML front matter"]),
    ["a --- thematic break later in the file passes (round 17)", { ...base, doc: good.replace(BEGIN, `\n---\n\n${BEGIN}`) }, null],
    ["a first line of --- then a form feed fails (round 18)", { ...base, doc: `---\f\n${good}` }, "YAML front matter"],
    // Round 19: raw HTML mid-line in prose, anywhere in the file.
    ...["<select>", '<select name="a">', "<details>", "<noscript>", "<template>", "<table>", "&lt;b&gt;"].map((x) =>
      [`prose holding ${x} mid-line fails (round 19)`, { ...base, doc: good.replace("Checked against launch profile v7.", `Checked against launch profile v7. ${x}`) }, 'outside a code span']),
    ["a heading holding <select> mid-line fails (round 19)", { ...base, doc: good.replace(BEGIN, `## Inventory <select>\n\n${BEGIN}`) }, "outside a code span"],
    ["a < inside a code span in prose passes (round 19)", { ...base, doc: good.replace("Checked against launch profile v7.", "Checked against launch profile v7. See `<Route>`.") }, null],
    ["a [ref]: line between two rows is reported, not a crash (round 19)", { ...base, doc: good.replace(INV_ROW, `[ref]: http://example.com\n${INV_ROW}`) }, "is not a page row"],
    // Round 20: past markdown-it's nesting limit, nothing inside a block is read.
    ...[100, 120].map((d) =>
      [`a ${d}-deep blockquote holding <select> fails (round 20)`, { ...base, doc: good.replace(BEGIN, `${">".repeat(d)} x <select> y\n\n${BEGIN}`) }, "nests blocks"]),
    ["a 17-deep blockquote fails (round 20)", { ...base, doc: good.replace(BEGIN, `${">".repeat(17)} plain text\n\n${BEGIN}`) }, "nests blocks"],
    ["a 3-deep blockquote passes (round 20)", { ...base, doc: good.replace(BEGIN, `>>> plain text\n\n${BEGIN}`) }, null],
    ["the < refusal names the line the < is on, not the paragraph's first line (round 20)", { ...base, doc: good.replace("Checked against launch profile v7.", "Checked against launch profile v7.\nsecond line\nthird <select> line") }, 'line 3 has "<" outside a code span ('],
    // Round 21: a code span only counts as code when every renderer agrees it is one.
    ...[["<details>", 81], ["<select name=a>", 81], ["<details>", 2]].map(([tag, n]) =>
      [`a ${tag} between two ${n}-backtick runs fails (round 21)`, { ...base, doc: good.replace(BEGIN, `x ${"`".repeat(n)} ${tag} ${"`".repeat(n)} y\n\n${BEGIN}`) }, "one-backtick code span"]),
    ["an escaped backtick does not open a code span around <b> (round 21)", { ...base, doc: good.replace(BEGIN, "x \\`<b>` y\n\n" + BEGIN) }, "one-backtick code span"],
    ["a code span split by a pipe does not shelter <b> (round 21)", { ...base, doc: good.replace(BEGIN, "x `a | <b>` y\n\n" + BEGIN) }, "one-backtick code span"],
    ["a < in a fenced block line fails too (round 21)", { ...base, doc: good.replace(BEGIN, "```\nx <b> y\n```\n\n" + BEGIN) }, "one-backtick code span"],
    ["a one-backtick `<Route>` on one line passes (round 21)", { ...base, doc: good.replace(BEGIN, "See `<Route>` and `<` here.\n\n" + BEGIN) }, null],
    ["a second table anywhere in the file fails (round 21)", { ...base, doc: good.replace(BEGIN, "| a | b |\n|---|---|\n| x | y |\n\n" + BEGIN) }, "holds 2 tables"],
    ["the < refusal skips a code-span < when naming the line (round 21)", { ...base, doc: good.replace("Checked against launch profile v7.", "Checked against launch profile v7. See `<Route>`.\nsecond <select> line") }, 'line 2 has "<" outside a code span ('],
    // A code span opened on the line before closes early here, so <b> is raw on GitHub; the
    // per-line raw scan pairs this line's backticks wrongly and misses it, markdown-it does not.
    ["a tag after a code span that opened on the previous line fails (round 21)", { ...base, doc: good.replace(BEGIN, "text `foo\nbar` <b> `x`\n\n" + BEGIN) }, 'outside a code span ('],
    // Round 22: GitHub's autolink takes a backtick that touches a URL, so the span is not code.
    ...["http://a.b/", "https://a.b/", "www.a.b/", "ftp://a.b/", "HTTP://a.b/", "(http://a.b/", "*http://a.b/", "http://a.b/(", "www.a.b/("].map((pre) =>
      [`a backtick touching ${pre} does not shelter <details> (round 22)`, { ...base, doc: good.replace(BEGIN, `see ${pre}\`<details>\` y\n\n${BEGIN}`) }, "one-backtick code span"]),
    ["a code span opening after a word character does not shelter <b> (round 22)", { ...base, doc: good.replace(BEGIN, "x y`<b>` z\n\n" + BEGIN) }, "one-backtick code span"],
    ["a code span after a URL and a space still passes (round 22)", { ...base, doc: good.replace(BEGIN, "see http://a.b/ `<b>` and (`<c>`) y\n\n" + BEGIN) }, null],
    // Round 23: only ASCII space and tab end a GitHub autolink.
    ...[["NBSP", "\u00a0"], ["U+2029", "\u2029"], ["U+3000", "\u3000"], ["VT", "\v"], ["FF", "\f"], ["U+202F", "\u202f"]].map(([name, ch]) =>
      [`a URL then ${name} then a backtick does not shelter <details> (round 23)`, { ...base, doc: good.replace(BEGIN, `see http://a.b/${ch}\`<details>\` y\n\n${BEGIN}`) }, "one-backtick code span"]),
    ["a URL then NBSP then ( then a code span does not shelter <details> (round 23)", { ...base, doc: good.replace(BEGIN, "see http://a.b/\u00a0(`<details>` y\n\n" + BEGIN) }, "one-backtick code span"],
    ["a URL then a tab then a code span still passes (round 23)", { ...base, doc: good.replace(BEGIN, "see http://a.b/\t`<b>` y\n\n" + BEGIN) }, null],
    // Round 18: a browser obeys raw HTML that cmark-gfm passes through a cell.
    ...["</table>", "</TABLE>", "</td></tr></table>", "<template>", "`<b>`"].map((x) =>
      [`a page row whose cell holds ${x} fails (round 18)`, { ...base, doc: good.replace(INV_ROW, INV_ROW.replace(/ \|$/, ` ${x} |`)) }, 'page row contains "<"']),
    ["prose punctuation touching a value fails closed", withProse("`-DemoBackendDevice ipad-ward-01`, then"), "gives -DemoBackendDevice ipad-ward-01,"],
    ["a stale launch-profile version fails", { ...base, profileVersion: 8 }, "launch profile v7"],
    ["a missing inventory block fails", { ...base, doc: good.replace(BEGIN, "") }, "no <!--"],
    ["a duplicated row fails", { ...base, doc: good.replace(END, `${row("signalgrid-web", pageFiles[4], "demo_only", "—")}\n${END}`) }, "listed 2 times"],
  ];
  let ok = true;
  // A failing case must fail FOR ITS REASON (the expected fragment appears in an error);
  // a passing case (null) must produce no error at all.
  for (const [name, input, expect] of cases) {
    const errs = check(input);
    const pass = expect === null ? errs.length === 0 : errs.some((e) => e.includes(expect));
    console.log(`  ${pass ? "✓" : "✗"} ${name}${pass ? "" : ` — got ${JSON.stringify(errs)}`}`);
    ok &&= pass;
  }
  // The real launch profile must be readable into statuses, or every real run is meaningless.
  const real = appSurfaceStatuses();
  const realOk = real.get("signalgrid-app") !== undefined && real.size > 0;
  console.log(`  ${realOk ? "✓" : "✗"} launch-profile.mjs app-surfaces reads into ${real.size} surface statuses`);
  ok &&= realOk;
  console.log(ok ? "✓ screen-inventory self-test: every check can fail" : "✗ screen-inventory self-test FAILED");
  process.exit(ok ? 0 : 1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (!isMain) {
  // imported for its pure functions
} else if (process.argv.includes("--self-test")) selfTest();
else {
  if (!existsSync(DOC)) {
    console.error(`✗ ${DOC} does not exist`);
    process.exit(1);
  }
  const pageFiles = trackedPages();
  const errors = check({
    doc: readFileSync(DOC, "utf8"),
    pageFiles,
    statuses: appSurfaceStatuses(),
    ...(({ placement, unparsed }) => ({ placements: placement, unparsedRoutes: unparsed }))(adminPlacements(readFileSync(ADMIN_ROUTES, "utf8"))),
    profileVersion: LAUNCH_PROFILE_VERSION,
  });
  if (errors.length) {
    for (const e of errors) console.error(`✗ ${e}`);
    console.error(`✗ screen inventory: ${errors.length} problem(s) in ${DOC}`);
    process.exit(1);
  }
  console.log(`✓ screen inventory: ${pageFiles.length} page files listed in ${DOC}, statuses match launch profile v${LAUNCH_PROFILE_VERSION}`);
}
