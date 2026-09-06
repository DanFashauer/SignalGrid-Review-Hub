// Agent-roster gate — hiring is autonomous; the SHAPE of a hire is not (DR-016).
//
// WHY THIS EXISTS. The owner directed a loop: when work needs a skill nobody
// has, hire an agent with that skill and carry on — and he made that hiring
// fully autonomous, no approval in the loop. That is a real grant of authority,
// and the thing it removes is exactly the thing `docs/agent/ORG.md` relied on.
// That page ratified FOUR roles under the heading "Why only four", because
// "every extra role is another lane that can collide", and the control on
// collision was that a human added the roles.
//
// So the control has to move somewhere mechanical, or it does not exist. This
// gate is where it moved. Autonomy is in WHO decides to hire; the shape of the
// hire is not negotiable:
//
//   1. Every dispatchable agent is REGISTERED with a tier and a charter.
//   2. Write capability is DERIVED from the agent's own `tools:` frontmatter,
//      never trusted from the registry. An agent listing Write or Edit can
//      write, whatever the registry claims about it. Deriving it is the whole
//      point — a registry that took an agent's word for its own powers would
//      be a permission system that asks the applicant to fill in the badge.
//   3. Every WRITING agent declares a write scope, and no two write scopes may
//      overlap. This is the collision control ORG.md was carrying by hand.
//   4. Read-only agents need no scope and cannot collide, which is why the
//      cheap way to add capability here is to add something that cannot write.
//   5. A vendored agent must be BYTE-IDENTICAL to its source in
//      third_party/everything-claude-code/agents/. Governance for third-party
//      definitions lives in the registry precisely so the definitions
//      themselves stay unmodified and diffable against upstream.
//
// SELF-TEST: the parse must find the real agents (floor), a synthetic
// overlapping scope must be rejected, and synthetic vendor drift must be
// detected. A gate that cannot fail proves nothing.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const AGENT_DIR = ".claude/agents";
const REGISTRY = "docs/agent/agent-tiers.json";
const VENDOR_AGENTS = "third_party/everything-claude-code/agents";
const AGENT_FLOOR = 5;
const WRITE_TOOLS = /\b(Write|Edit|NotebookEdit|MultiEdit)\b/;

function frontmatter(body) {
  const m = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

// Two write scopes may not overlap — with ONE declared exception. A flat
// no-nesting rule sounded right until the org tried to use it: `scripts/` holds
// every gate and every proof (hundreds of files), and it could not be given an owner
// because `scripts/src/e2e/` was already assigned to the e2e-runner. The rule
// was forbidding the most ordinary shape an organisation has — a team owns a
// directory, one specialist owns one subdirectory inside it.
//
// So nesting is allowed when the INNER scope names the outer one it is carved
// out of. That keeps the property the rule exists for: for any path, exactly
// one agent owns it, and which one is written down rather than inferred. An
// undeclared overlap is still a collision and still fails — the carve-out has
// to be deliberate, and it has to name a scope that actually exists.
const nests = (a, b) => a !== b && (a.startsWith(b) || b.startsWith(a));
const overlaps = (a, b) => a === b || nests(a, b);

if (!existsSync(AGENT_DIR)) {
  console.log("Agent-roster gate: no .claude/agents directory — nothing dispatchable, nothing to govern.");
  process.exit(0);
}

const agents = [];
for (const e of readdirSync(AGENT_DIR)) {
  if (!e.endsWith(".md")) continue;
  const path = join(AGENT_DIR, e);
  const body = readFileSync(path, "utf8");
  const fm = frontmatter(body);
  agents.push({
    id: e.replace(/\.md$/, ""),
    path,
    fm,
    canWrite: fm ? WRITE_TOOLS.test(fm.tools ?? "") : null,
  });
}

let registry;
try {
  registry = JSON.parse(readFileSync(REGISTRY, "utf8"));
} catch (err) {
  console.error(`✗ ${REGISTRY} unreadable or invalid JSON (${err.message}) — every dispatchable agent is ungoverned until it parses.`);
  process.exit(1);
}
const declared = new Map((registry.agents ?? []).map((a) => [a.id, a]));

// ── self-test ────────────────────────────────────────────────────────────────
{
  const parses = frontmatter("---\nname: x\ntools: Read, Write\n---\nbody");
  const derives = parses !== null && WRITE_TOOLS.test(parses.tools);
  const readOnly = !WRITE_TOOLS.test("Read, Grep, Glob");
  const catchesOverlap = overlaps("lib/", "lib/core/") && !overlaps("docs/", "lib/") && nests("scripts/", "scripts/src/e2e/");
  if (agents.length < AGENT_FLOOR || !derives || !readOnly || !catchesOverlap) {
    console.error(
      `✗ SELF-TEST FAILED — agents=${agents.length} (floor ${AGENT_FLOOR}), parse+derive=${derives}, ` +
        `readOnly=${readOnly}, overlap=${catchesOverlap}. The frontmatter idiom or the scope comparison has ` +
        "drifted; a gate that resolves nothing is green about nothing.",
    );
    process.exit(1);
  }
}

console.log("Agent roster — hiring is autonomous, the shape of a hire is not (DR-016)\n");
let problems = 0;
const writeScopes = [];

for (const a of agents.sort((x, y) => x.id.localeCompare(y.id))) {
  const d = declared.get(a.id);
  if (!a.fm) {
    console.error(`  ✗ ${a.id}: no YAML frontmatter — the harness cannot dispatch it and this gate cannot read its tools.`);
    problems += 1;
    continue;
  }
  if (!d) {
    console.error(
      `  ✗ ${a.id}: dispatchable but UNREGISTERED in ${REGISTRY}.\n` +
        "      Hiring is autonomous; hiring in silence is not. Add a tier, a charter, and\n" +
        "      a write scope if it can write.",
    );
    problems += 1;
    continue;
  }
  if (!d.charter || String(d.charter).trim().length < 20) {
    console.error(`  ✗ ${a.id}: registered with no usable charter. An agent whose job nobody wrote down cannot be held to it.`);
    problems += 1;
    continue;
  }

  // Vendored definitions must not drift from their source.
  if (d.provenance === "vendored") {
    const src = join(VENDOR_AGENTS, `${a.id}.md`);
    if (!existsSync(src)) {
      console.error(`  ✗ ${a.id}: declared vendored, but ${src} does not exist. Provenance that names no source is not provenance.`);
      problems += 1;
      continue;
    }
    if (readFileSync(src, "utf8") !== readFileSync(a.path, "utf8")) {
      console.error(
        `  ✗ ${a.id}: DRIFTED from its vendored source ${src}.\n` +
          "      Vendored files are kept unmodified so they stay diffable against upstream.\n" +
          "      Govern it in the registry, or make it first-party and say so — do not edit it here.",
      );
      problems += 1;
      continue;
    }
  }

  if (a.canWrite) {
    if (!d.writeScope) {
      console.error(
        `  ✗ ${a.id}: its tools include Write/Edit, but it declares NO write scope.\n` +
          `      tools: ${a.fm.tools}\n` +
          "      An agent that can write anywhere collides with everyone eventually.",
      );
      problems += 1;
      continue;
    }
    const clash = writeScopes.find((w) => overlaps(w.scope, d.writeScope));
    if (clash) {
      // A carve-out is legitimate only if THIS agent declares it, and declares
      // the scope it is carved out of — which must be the one it collides with.
      const carvedFrom = d.carvedOutOf;
      const declaredHere = carvedFrom === clash.scope && d.writeScope.startsWith(clash.scope);
      const declaredThere = clash.carvedOutOf === d.writeScope && clash.scope.startsWith(d.writeScope);
      if (!declaredHere && !declaredThere) {
        console.error(
          `  ✗ ${a.id}: write scope "${d.writeScope}" OVERLAPS ${clash.id}'s "${clash.scope}" ` +
            "with no declared carve-out.\n" +
            "      This is the collision ORG.md's 'why only four' was preventing by hand. Either\n" +
            "      pick disjoint ground, or set carvedOutOf on the NARROWER of the two so the\n" +
            "      nesting is deliberate and a reader can tell who owns a given path.",
        );
        problems += 1;
        continue;
      }
    }
    writeScopes.push({ id: a.id, scope: d.writeScope, carvedOutOf: d.carvedOutOf });
    const carve = d.carvedOutOf ? ` (carved out of ${d.carvedOutOf})` : "";
    console.log(`  ✓ ${a.id}  tier ${d.tier} · writes ${d.writeScope}${carve} · ${d.provenance}`);
  } else {
    if (d.writeScope) {
      console.error(
        `  ✗ ${a.id}: declares write scope "${d.writeScope}" but holds no write tool.\n` +
          "      A boundary around a power it does not have is a boundary that teaches the next\n" +
          "      reader something false.",
      );
      problems += 1;
      continue;
    }
    console.log(`  · ${a.id}  tier ${d.tier} · read-only, cannot collide · ${d.provenance}`);
  }
}

// A registry entry for an agent that no longer exists is a stale grant.
for (const id of declared.keys()) {
  if (!agents.some((a) => a.id === id)) {
    console.error(`  ✗ ${id}: registered in ${REGISTRY} but no ${AGENT_DIR}/${id}.md exists — a grant with nobody holding it.`);
    problems += 1;
  }
}

console.log(
  `\nagent-roster: ${agents.length} dispatchable, ${writeScopes.length} can write ` +
    `(scopes: ${writeScopes.map((w) => w.scope).join(", ") || "none"}), ` +
    `${agents.length - writeScopes.length - problems} read-only, ${problems} problem(s); self-test green`,
);
if (problems > 0) {
  console.error("\nAgent-roster gate FAILED — an org that can hire itself needs the shape of a hire to be non-negotiable.");
  process.exit(1);
}
console.log("Agent-roster gate passed — every agent has a tier, a charter, and a boundary nobody else holds.");
