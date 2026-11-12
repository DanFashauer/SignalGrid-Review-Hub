// preflight-slice.mjs — the pure half of running preflight as N slices on N machines.
//
// WHY. One hosted macOS runner needs about 41 minutes for the whole registry and the PR Mac
// check's work bound is 40 (run 43163039070 and run 43211433896 both ended at the deadline with
// no gate failed). The registry is not cut down and the bound is not raised: the SAME ordered
// STEPS list is run once, split across slices, and one aggregate judges the union.
//
// WHAT IS HERE. No process, clock, filesystem or network: only the plan, who owns which step,
// what a slice must run first, the record a slice hands over, and the judgement of a set of
// records. scripts/preflight.mjs does the running; scripts/mac/build-tick-stages.mjs --self-test
// holds the regressions.
//
// FAIL-CLOSED. A step field this file does not know, a value it cannot bind into the hash, a
// record it cannot read, a slice that is absent, a step nobody ran, a step two slices ran, a
// step recorded out of order or under another role: each is a refusal, never a pass.
import { createHash } from "node:crypto";

export const RECORD_VERSION = 1;
/** Every field a STEPS entry may carry. An unknown field is refused, not silently left out of
 *  the hash: a field that changes what runs or how it is judged must change the plan. */
const STEP_FIELDS = new Set(["name", "cmd", "env", "heavy", "needsNativeBuild", "selfSkipsWithout", "surface", "prerequisiteForLater"]);
/** A non-pass is accepted only where the STEP'S OWN DECLARATION allows it, exactly as plain
 *  preflight can only produce it there (scripts/lib/preflight-verdict.mjs and the runner's two
 *  skips). A record cannot talk an ordinary gate into "unavailable" or "self-skipped".
 *    ok          — any step;
 *    reported / unverified — only a step that declares a `surface`;
 *    skipped-db  — only a step that declares `selfSkipsWithout`;
 *    unavailable — only a step that declares `needsNativeBuild`;
 *    skipped     — never: it exists only under --quick, and a slice refuses --quick. */
export function statusAllowed(status, step) {
  if (status === "ok") return true;
  if (status === "reported" || status === "unverified") return step.surface !== null;
  if (status === "skipped-db") return step.selfSkipsWithout !== null;
  if (status === "unavailable") return step.needsNativeBuild === true;
  return false;
}

const refuse = (message) => { throw new Error(`preflight-slice: ${message}`); };

/** `--slice k/n` → { index: k, count: n }. 2..8 slices; k in 1..n. */
export function parseSlice(text) {
  const m = /^([1-9])\/([2-8])$/.exec(String(text ?? ""));
  if (!m || Number(m[1]) > Number(m[2])) refuse(`--slice wants k/n with 2 <= n <= 8 and 1 <= k <= n, got ${JSON.stringify(text)}`);
  return { index: Number(m[1]), count: Number(m[2]) };
}

/** The complete, ordered, checkout-independent plan: every field of every step. `repo` is the
 *  absolute checkout path; where a step's env embeds it, the plan says "<repo>" so two checkouts
 *  of one commit agree. */
export function planOf(steps, repo) {
  if (!Array.isArray(steps) || steps.length === 0) refuse("the step registry is empty");
  if (typeof repo !== "string" || repo.length < 2) refuse("the checkout path is not known");
  const text = (value, where) => {
    if (typeof value !== "string") refuse(`${where} is not a string`);
    return value.split(repo).join("<repo>");
  };
  const seen = new Set();
  return steps.map((step, index) => {
    if (!step || typeof step !== "object") refuse(`step ${index} is not an object`);
    for (const key of Object.keys(step)) if (!STEP_FIELDS.has(key)) refuse(`step ${index} carries a field this plan does not bind: ${key}`);
    const name = text(step.name, `step ${index} name`);
    if (seen.has(name)) refuse(`two steps are named ${JSON.stringify(name)}`);
    seen.add(name);
    if (!Array.isArray(step.cmd) || step.cmd.length === 0) refuse(`step ${index} has no argv`);
    const flag = (key) => {
      if (step[key] !== undefined && typeof step[key] !== "boolean") refuse(`step ${index} ${key} is not a boolean`);
      return step[key] === true;
    };
    let surface = null;
    if (step.surface !== undefined) {
      if (!(step.surface instanceof RegExp)) refuse(`step ${index} surface is not a RegExp`);
      surface = { source: step.surface.source, flags: step.surface.flags };
    }
    const env = {};
    if (step.env !== undefined) {
      if (!step.env || typeof step.env !== "object" || Array.isArray(step.env)) refuse(`step ${index} env is not an object`);
      for (const key of Object.keys(step.env).sort()) env[key] = text(step.env[key], `step ${index} env.${key}`);
    }
    return {
      index, name, cmd: step.cmd.map((part, i) => text(part, `step ${index} argv[${i}]`)), env,
      heavy: flag("heavy"), needsNativeBuild: flag("needsNativeBuild"), prerequisiteForLater: flag("prerequisiteForLater"),
      selfSkipsWithout: step.selfSkipsWithout === undefined ? null : text(step.selfSkipsWithout, `step ${index} selfSkipsWithout`),
      surface,
    };
  });
}

export const planHash = (plan) => createHash("sha256").update(JSON.stringify(plan)).digest("hex");

/** Contiguous, equal-count ownership: no boundary is kept by hand. 1-based slice number. */
export function ownerOf(index, total, count) {
  if (!Number.isInteger(index) || index < 0 || index >= total) refuse(`step index ${index} is outside 0..${total - 1}`);
  return Math.floor((index * count) / total) + 1;
}

/** What slice `slice.index` does with step `index`:
 *    "owned"   — it is this slice's step: run, judged and counted once;
 *    "prelude" — an earlier slice owns it, but it is declared a prerequisite for later steps
 *                and this slice owns a later one: run first, never counted as this slice's pass;
 *    "other"   — not this slice's business. */
export function roleOf(index, plan, slice) {
  const owner = ownerOf(index, plan.length, slice.count);
  if (owner === slice.index) return "owned";
  return owner < slice.index && plan[index].prerequisiteForLater ? "prelude" : "other";
}

/** The exact (index, role) sequence a complete slice record must carry, in registry order. */
export function expectedSequence(plan, slice) {
  const out = [];
  for (let index = 0; index < plan.length; index += 1) {
    const role = roleOf(index, plan, slice);
    if (role !== "other") out.push([index, role]);
  }
  return out;
}

/** What a slice hands the aggregate. `steps` is [[index, role, status, exit], …] in run order. */
export function sliceRecord({ slice, checkout, prHead, attempt, plan, steps }) {
  return { v: RECORD_VERSION, slice: slice.index, count: slice.count, checkout, prHead, attempt: attempt ?? null, plan: planHash(plan), total: plan.length, steps };
}

const SHA = /^[0-9a-f]{40}$/;

/** Judge a set of slice records against THIS checkout's plan. Returns { ok, problems, counts }.
 *  `records` is what was found (any shape: it is checked); `jobResult` is the CI result of the
 *  slice jobs ("success" is the only acceptable one; pass null where there is no CI). */
export function aggregate({ records, plan, count, checkout, prHead, attempt, jobResult = "success" }) {
  const problems = [];
  const hash = planHash(plan);
  if (jobResult !== null && jobResult !== "success") problems.push(`the slice jobs ended ${JSON.stringify(jobResult)}, not "success" — a failed, cancelled or skipped slice is not a pass`);
  if (!Number.isInteger(count) || count < 2 || count > 8) problems.push(`slice count ${JSON.stringify(count)} is not 2..8`);
  if (!SHA.test(checkout ?? "")) problems.push("this checkout's commit is not known");
  if (!Array.isArray(records)) return { ok: false, problems: [...problems, "no slice records were read"], counts: {} };
  const bySlice = new Map();
  for (const record of records) {
    if (!record || typeof record !== "object" || record.v !== RECORD_VERSION) { problems.push(`a record is not a version-${RECORD_VERSION} slice record`); continue; }
    if (!Number.isInteger(record.slice) || record.slice < 1 || record.slice > count || record.count !== count) { problems.push(`a record names slice ${JSON.stringify(record.slice)} of ${JSON.stringify(record.count)}, not one of ${count}`); continue; }
    if (bySlice.has(record.slice)) { problems.push(`slice ${record.slice} was recorded twice`); continue; }
    bySlice.set(record.slice, record);
  }
  const ran = new Map(); // index -> owning slice that recorded it
  const counts = {};
  for (let k = 1; k <= count; k += 1) {
    const record = bySlice.get(k);
    if (!record) { problems.push(`slice ${k}/${count} left no record — missing, cancelled or skipped`); continue; }
    if (record.plan !== hash || record.total !== plan.length) { problems.push(`slice ${k} ran another plan (${String(record.plan).slice(0, 12)}…, ${record.total} steps) than this checkout's (${hash.slice(0, 12)}…, ${plan.length} steps)`); continue; }
    if (record.checkout !== checkout) { problems.push(`slice ${k} ran checkout ${String(record.checkout).slice(0, 12)}, not ${String(checkout).slice(0, 12)}`); continue; }
    if ((record.prHead ?? null) !== (prHead ?? null)) { problems.push(`slice ${k} names PR head ${String(record.prHead).slice(0, 12)}, not ${String(prHead).slice(0, 12)}`); continue; }
    // One workflow run ATTEMPT, never a mix: a record kept from an earlier attempt is not this attempt's result.
    if ((record.attempt ?? null) !== (attempt ?? null)) { problems.push(`slice ${k} belongs to run attempt ${JSON.stringify(record.attempt ?? null)}, not ${JSON.stringify(attempt ?? null)} — records of different attempts are never combined`); continue; }
    const expected = expectedSequence(plan, { index: k, count });
    const steps = Array.isArray(record.steps) ? record.steps : [];
    for (let i = 0; i < Math.max(expected.length, steps.length); i += 1) {
      const want = expected[i], got = steps[i];
      if (!want) { problems.push(`slice ${k} recorded a step it does not own: ${JSON.stringify(got)}`); break; }
      const label = `slice ${k} step ${want[0]} (${plan[want[0]].name})`;
      if (!Array.isArray(got) || got.length !== 4) { problems.push(`${label} was not run — the slice stopped or its record is partial`); break; }
      const [index, role, status, exit] = got;
      if (index !== want[0] || role !== want[1]) { problems.push(`${label} is missing or out of order: the record has ${JSON.stringify([index, role])} there`); break; }
      if (role === "prelude") {
        if (status !== "ok" || exit !== 0) { problems.push(`${label} is a prerequisite that did not pass (${status}, exit ${exit}) — what it sets up for this slice is absent`); break; }
        continue;
      }
      if (ran.has(index)) { problems.push(`${label} was also run by slice ${ran.get(index)}`); break; }
      ran.set(index, k);
      if (status === "failed") { problems.push(`${label} FAILED (exit ${exit})`); break; }
      if (!["ok", "reported", "unverified", "skipped-db", "unavailable", "skipped"].includes(status)) { problems.push(`${label} has an unknown status ${JSON.stringify(status)} (exit ${exit})`); break; }
      if (!statusAllowed(status, plan[index])) { problems.push(`${label} is recorded ${status}, which this step does not declare it can be — an ordinary gate is run and passes, or the slice fails`); break; }
      if (exit !== 0) { problems.push(`${label} is recorded ${status} with exit ${exit}`); break; }
      counts[status] = (counts[status] ?? 0) + 1;
    }
  }
  for (let index = 0; index < plan.length; index += 1) {
    if (!ran.has(index) && problems.length === 0) problems.push(`step ${index} (${plan[index].name}) was run by no slice`);
  }
  return { ok: problems.length === 0, problems, counts, ran: ran.size, total: plan.length, hash };
}
