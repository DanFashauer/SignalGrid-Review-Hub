// Decision-record format gate — the contract the file makes about itself.
//
// docs/DECISION_RECORDS.md opens by stating that each record carries the
// question, the call, "the evidence actually read, and — the part that makes
// delegation safe — exactly what would reverse it." That is the sentence that
// makes delegated authority safe to grant: a call nobody can undo is not a
// delegated call, it is a fait accompli.
//
// Nothing read that sentence. The org sweep measured the drift: DR-001 through
// DR-009 complied, and DR-010, DR-011, DR-012 and DR-013 — the four written in
// a single fast-moving day — carried no reversal clause at all. The contract
// held exactly as long as the person writing records happened to remember it.
//
// What this gate requires of every record:
//   1. a QUESTION — what was being decided;
//   2. the CALL — what was decided;
//   3. GROUNDING — the evidence actually read, or the owner instruction the
//      call came from;
//   4. a REVERSAL statement — how the call gets undone.
//
// GATED vs REPORTED, the same split this repo uses everywhere else:
//   · The REVERSAL clause is GATED. It is the preamble's explicit safety
//     promise ("the part that makes delegation safe"), it is unambiguous, and
//     it is the exact property that drifted — four records in one day.
//   · Question / call / grounding are REPORTED. All thirteen records contain
//     them in substance, but their prose shape varies legitimately across four
//     days of writing (a compound record like DR-005 states five questions; an
//     owner-directed record states its instruction instead of an Evidence
//     block). Failing on that would be a gate policing style, and the fix
//     would be thirteen rewrites in service of a regex.
//
// An earlier draft of this gate demanded a "**Status:**" line too and reported
// nine of thirteen incomplete — status lines are a DR-008-onward convention
// the file never promised. Rewriting nine older records to satisfy an invented
// requirement would have been the gate rewriting history to suit itself.
//
// A record may be exempted only by name, with a reason, in DECLARED below.
//
// SELF-TEST: the parser must find the real records (floor), and a synthetic
// record missing a reversal clause must be flagged. A gate that cannot fail
// proves nothing.
import { readFileSync } from "node:fs";

const FILE = "docs/DECISION_RECORDS.md";
const RECORD_FLOOR = 10;
const DECLARED = new Map();

const REVERSAL = /\*\*Revers|Reversal\b|reverse it|reversal path|reversal clause/i;
const QUESTION = /\*\*Question|\*\*The question|^#{2,3}[^\n]*\?/im;
const CALL = /\*\*(?:Decision|The call|Call|Proposal|The doctrine|What we did)/i;
// Grounding: an explicit Evidence block, OR a stated owner instruction — both
// are "what this rests on", and owner-directed records legitimately rest on
// the instruction rather than on files.
const GROUNDING = /\*\*Evidence|\bEvidence\.|owner-directed|owner's own (?:words|direction)|in his own words|ratified by (?:the )?owner|decision session|measured|verified/i;

function records(src) {
  const parts = src.split(/\n## (?=DR-\d+)/);
  return parts
    .slice(1)
    .map((chunk) => {
      const title = chunk.split("\n", 1)[0].trim();
      const id = (title.match(/^DR-\d+/) || ["?"])[0];
      return { id, title, body: chunk };
    });
}

const src = readFileSync(FILE, "utf8");
const recs = records(src);

// ── self-test ────────────────────────────────────────────────────────────────
{
  const synthetic =
    "\n## DR-999 — a synthetic call (2026-01-01)\n\n**Decision.** Something.\n\n**Status: ratified.**\n";
  const parsed = records(synthetic);
  const parserWorks = parsed.length === 1 && parsed[0].id === "DR-999";
  const catchesMissingReversal = parserWorks && !REVERSAL.test(parsed[0].body);
  if (recs.length < RECORD_FLOOR || !parserWorks || !catchesMissingReversal) {
    console.error(
      `✗ SELF-TEST FAILED — records=${recs.length} (floor ${RECORD_FLOOR}), parser=${parserWorks}, ` +
        `negative=${catchesMissingReversal}. The parser has drifted from the file's heading idiom; ` +
        "a gate scanning nothing is green about nothing.",
    );
    process.exit(1);
  }
}

console.log(`Decision-record format — the contract ${FILE} makes about itself\n`);
let problems = 0;
let reported = 0;
for (const r of recs) {
  if (DECLARED.has(r.id)) {
    console.log(`  · ${r.id}: DECLARED exempt — ${DECLARED.get(r.id)}`);
    continue;
  }
  const soft = [];
  if (!QUESTION.test(r.body)) soft.push("question");
  if (!CALL.test(r.body)) soft.push("call");
  if (!GROUNDING.test(r.body)) soft.push("grounding");
  if (!REVERSAL.test(r.body)) {
    console.error(`  ✗ ${r.id}: NO REVERSAL CLAUSE — ${r.title.slice(0, 60)}`);
    problems += 1;
  } else if (soft.length > 0) {
    console.log(`  ✓ ${r.id}  (reported, not gated: ${soft.join("/")} stated in prose rather than a labelled section)`);
    reported += 1;
  } else {
    console.log(`  ✓ ${r.id}`);
  }
}

console.log(`\ndecision-record-format: ${recs.length} records, ${problems} without a reversal clause (GATED), ${reported} with prose-shaped sections (REPORTED); self-test green`);
if (problems > 0) {
  console.error(
    "\nDecision-record format gate FAILED. The file's own preamble promises every record\n" +
      "states exactly what would reverse it — that promise is what makes delegated authority\n" +
      "safe to grant. Add the missing section; never relax the contract to fit a record.",
  );
  process.exit(1);
}
console.log("Decision-record format gate passed — every call states how it gets undone.");
