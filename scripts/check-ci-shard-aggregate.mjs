// CI shard-aggregate gate — the required check must not be able to pass on a shard
// that did not.
//
// WHY THIS EXISTS. The proof scaffold used to be one serial job whose name,
// `Typecheck, build, and proof scaffold`, is the context branch protection requires.
// It now runs as parallel shards (review-hub-ci.yml: `validation`,
// `validation-heavy-a`, `validation-heavy-b`), and the required name sits on an
// aggregate job, `validation-gate`. That move has one way to fail open and it is
// silent: GitHub reports a required job that was SKIPPED as satisfied. A plain
// `needs:` aggregate is skipped whenever a shard fails or is cancelled, so the
// required check would read green on exactly the runs it exists to stop.
//
// WHAT IS GATED, on the real workflow:
//   1. exactly one job in .github/workflows carries the required name, and it is
//      the aggregate;
//   2. the aggregate always runs (`if: ${{ always() }}`), is bounded, and has no
//      `continue-on-error`;
//   3. it `needs:` every shard, and every `validation*` job other than itself is a
//      shard it needs — a shard added later cannot sit outside the verdict;
//   4. each shard's result reaches the verdict script through an env var bound to
//      `needs.<that shard>.result`, and no shard softens its own result
//      (`continue-on-error` at job or step level, or a job-level `if:`);
//   5. the verdict script ITSELF, extracted from the workflow and executed under
//      `bash -e` for every combination of results, exits 0 only when every shard is
//      literally `success`. `failure`, `cancelled`, `skipped`, an empty value, a
//      missing variable and a near-miss spelling all exit non-zero.
//
// What this does NOT establish: that GitHub evaluates `always()` and `needs.*.result`
// as documented. That is the platform's contract; a hosted run is the evidence for it.
//
// SELF-TEST (runs on every invocation, before the real file is judged): a correct
// synthetic workflow passes, and each planted defect is refused by the clause that
// names it. A gate that cannot fail proves nothing.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = ".github/workflows";
const FILE = "review-hub-ci.yml";
const REQUIRED = "Typecheck, build, and proof scaffold";
const AGGREGATE = "validation-gate";
const SHARD_ID = /^validation(?:-[a-z0-9-]+)?$/;
/** Every value a shard result can take, plus the shapes that must not slip through. */
const RESULTS = ["success", "failure", "cancelled", "skipped", "", "Success", "success "];

/** Top-level jobs of a workflow: id, the job's own text block, and its scalar keys. */
function jobsIn(text) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (start === -1) return [];
  const keys = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\S/.test(lines[i])) break;
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[i]);
    if (m) keys.push({ id: m[1], at: i });
  }
  return keys.map((k, idx) => {
    const end = idx + 1 < keys.length ? keys[idx + 1].at : lines.length;
    const block = lines.slice(k.at + 1, end);
    // A job's own keys sit at exactly four spaces; a step's sit deeper.
    const own = (key) => {
      const m = block.map((l) => new RegExp(`^ {4}${key}:\\s*(.*)$`).exec(l)).find(Boolean);
      return m ? m[1].trim() : null;
    };
    return { id: k.id, block, name: own("name"), cond: own("if"), needs: own("needs"), timeout: own("timeout-minutes"), softJob: own("continue-on-error") };
  });
}

const unquote = (s) => (s === null ? null : s.replace(/^(["'])(.*)\1$/, "$2"));

/** `needs: [a, b]` or `needs: a` → ids. A block-sequence form is refused by the caller. */
function needsList(raw) {
  if (raw === null || raw === "") return null;
  const inner = raw.startsWith("[") && raw.endsWith("]") ? raw.slice(1, -1) : raw;
  return inner.split(",").map((s) => unquote(s.trim())).filter((s) => s.length > 0);
}

/** The aggregate's `env:` bindings and its `run: |` script, from its single step. */
function verdictStep(block) {
  const env = new Map();
  const script = [];
  let inEnv = false;
  let inRun = false;
  let runs = 0;
  let steps = 0;
  for (const line of block) {
    if (/^ {6}- /.test(line)) { steps += 1; inEnv = false; inRun = false; }
    if (inRun) {
      if (line.trim() === "" || /^ {10}/.test(line)) { script.push(line.replace(/^ {10}/, "")); continue; }
      inRun = false;
    }
    if (/^ {8}env:\s*$/.test(line)) { inEnv = true; continue; }
    if (/^ {8}run: \|\s*$/.test(line)) { inRun = true; inEnv = false; runs += 1; continue; }
    if (/^ {8}run:/.test(line)) { runs += 1; inEnv = false; continue; }
    if (inEnv) {
      const m = /^ {10}([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
      if (m) env.set(m[1], m[2].trim());
      else if (!/^ {10}/.test(line)) inEnv = false;
    }
  }
  return { env, script: script.join("\n"), runs, steps };
}

/** Run the verdict script the way Actions runs a `run:` block, with ONLY these variables. */
function runVerdict(script, vars) {
  const r = spawnSync("bash", ["-e", "-c", script], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin", ...vars }, encoding: "utf8", timeout: 10_000 });
  return r.status;
}

/**
 * Judge one workflow set. `files` maps a workflow filename to its text. Returns the list
 * of problems; empty means the aggregate is sound.
 */
function problemsIn(files) {
  const problems = [];
  const named = [];
  for (const [file, text] of files) {
    for (const job of jobsIn(text)) if (unquote(job.name) === REQUIRED) named.push(`${file}:${job.id}`);
  }
  if (named.length !== 1) {
    problems.push(`the required name "${REQUIRED}" is carried by ${named.length} job(s) [${named.join(", ") || "none"}] — exactly one, the aggregate, may carry it`);
  }
  const text = files.get(FILE);
  if (text === undefined) return [...problems, `${FILE} is missing`];
  const jobs = jobsIn(text);
  const gate = jobs.find((j) => j.id === AGGREGATE);
  if (!gate) return [...problems, `${FILE} has no \`${AGGREGATE}\` job`];
  if (unquote(gate.name) !== REQUIRED) problems.push(`\`${AGGREGATE}\` is named "${gate.name}", not the required name — the required context has moved off the aggregate`);
  if (gate.cond === null || gate.cond.replace(/\s+/g, "") !== "${{always()}}") {
    problems.push(`\`${AGGREGATE}\` has \`if: ${gate.cond ?? "(none)"}\` — it must be exactly \`\${{ always() }}\`, or a failed or cancelled shard SKIPS it and a skipped required job reads as passing`);
  }
  if (gate.timeout === null) problems.push(`\`${AGGREGATE}\` has no job-level timeout-minutes`);
  if (gate.softJob !== null) problems.push(`\`${AGGREGATE}\` sets continue-on-error — its failure would not fail the run`);

  const needs = needsList(gate.needs);
  if (needs === null) return [...problems, `\`${AGGREGATE}\` has no inline \`needs:\` list this gate can read (write it as \`needs: [a, b]\`)`];
  const shards = jobs.filter((j) => j.id !== AGGREGATE && SHARD_ID.test(j.id)).map((j) => j.id);
  for (const id of shards) if (!needs.includes(id)) problems.push(`shard \`${id}\` is not in \`${AGGREGATE}\`'s needs — it could fail without failing the required check`);
  for (const id of needs) {
    const job = jobs.find((j) => j.id === id);
    if (!job) { problems.push(`\`${AGGREGATE}\` needs \`${id}\`, which ${FILE} does not define`); continue; }
    if (job.softJob !== null) problems.push(`shard \`${id}\` sets job-level continue-on-error — its result would not carry a failure`);
    if (job.cond !== null) problems.push(`shard \`${id}\` has a job-level \`if:\` — a shard that can be skipped by condition has no place under a verdict that requires success`);
    if (job.block.some((l) => /^ {8}continue-on-error:/.test(l))) problems.push(`shard \`${id}\` has a step with continue-on-error — a failing step would leave the shard's result success`);
  }
  if (needs.length < 2) problems.push(`\`${AGGREGATE}\` needs ${needs.length} job(s) — an aggregate over fewer than two shards is not the split this gate guards`);

  const { env, script, runs, steps } = verdictStep(gate.block);
  if (steps !== 1 || runs !== 1) problems.push(`\`${AGGREGATE}\` has ${steps} step(s) and ${runs} run block(s) — the verdict must be one step, so nothing can run after or instead of it`);
  if (gate.block.some((l) => /^ {8}(if|continue-on-error|shell):/.test(l))) problems.push(`\`${AGGREGATE}\`'s verdict step carries an if / continue-on-error / shell key — the verdict must run unconditionally under the default shell`);
  // Each shard's result must arrive through a variable bound to THAT shard and no other.
  const varOf = new Map();
  for (const id of needs) {
    const want = "${{needs." + id + ".result}}";
    const bound = [...env].filter(([, v]) => v.replace(/\s+/g, "") === want).map(([k]) => k);
    if (bound.length !== 1) problems.push(`shard \`${id}\`: ${bound.length} env variable(s) are bound to needs.${id}.result — exactly one must be`);
    else varOf.set(id, bound[0]);
  }
  for (const [k, v] of env) if (![...varOf.values()].includes(k)) problems.push(`env \`${k}: ${v}\` is not a shard result binding — the verdict step may read shard results and nothing else`);
  if (varOf.size !== needs.length || script.trim() === "") {
    if (script.trim() === "") problems.push(`\`${AGGREGATE}\` has no \`run: |\` verdict script`);
    return problems;
  }

  // The verdict itself, executed: every combination of results, and a missing variable.
  const ids = [...varOf.keys()];
  const combos = ids.reduce((acc) => acc.flatMap((c) => RESULTS.map((r) => [...c, r])), [[]]);
  let wrong = 0;
  let firstWrong = null;
  for (const combo of combos) {
    const vars = Object.fromEntries(ids.map((id, i) => [varOf.get(id), combo[i]]));
    const expectPass = combo.every((r) => r === "success");
    const status = runVerdict(script, vars);
    if ((status === 0) !== expectPass) {
      wrong += 1;
      firstWrong ??= `${ids.map((id, i) => `${id}=${JSON.stringify(combo[i])}`).join(" ")} → exit ${status}, expected ${expectPass ? "0" : "non-zero"}`;
    }
  }
  if (wrong > 0) problems.push(`the verdict script is wrong on ${wrong} of ${combos.length} result combination(s); first: ${firstWrong}`);
  for (const id of ids) {
    const vars = Object.fromEntries(ids.filter((o) => o !== id).map((o) => [varOf.get(o), "success"]));
    if (runVerdict(script, vars) === 0) problems.push(`the verdict script passes when \`${varOf.get(id)}\` (shard \`${id}\`) is not set at all`);
  }
  return problems;
}

// ── self-test ──────────────────────────────────────────────────
{
  const good = [
    "name: T", "on: push", "jobs:",
    "  validation:", "    name: Shard 1", "    runs-on: x", "    timeout-minutes: 5", "    steps:", "      - name: a", "        run: echo a",
    "  validation-heavy-a:", "    name: Shard 2", "    runs-on: x", "    timeout-minutes: 5", "    steps:", "      - name: b", "        run: echo b",
    `  ${AGGREGATE}:`, `    name: ${REQUIRED}`, "    runs-on: x", "    timeout-minutes: 5",
    "    needs: [validation, validation-heavy-a]", "    if: ${{ always() }}", "    steps:",
    "      - name: verdict", "        env:", "          R_ONE: ${{ needs.validation.result }}", "          R_TWO: ${{ needs.validation-heavy-a.result }}",
    "        run: |", '          [ "${R_ONE:-}" = "success" ]', '          [ "${R_TWO:-}" = "success" ]',
    "  other:", "    name: Other", "    runs-on: x", "    timeout-minutes: 5", "    steps:", "      - run: echo o", "",
  ].join("\n");
  const judge = (text, extra = []) => problemsIn(new Map([[FILE, text], ...extra]));
  const swap = (from, to) => {
    if (!good.includes(from)) throw new Error(`self-test fixture lost its anchor: ${from}`);
    return good.replace(from, to);
  };
  const refused = (text, needle, extra) => judge(text, extra).some((p) => p.includes(needle));
  const checks = [
    ["a correct aggregate passes", judge(good).length === 0],
    ["a plain needs aggregate (no always) is refused", refused(swap("    if: ${{ always() }}\n", ""), "must be exactly")],
    ["`!cancelled()` is refused — a cancelled run would skip the required job", refused(swap("if: ${{ always() }}", "if: ${{ !cancelled() }}"), "must be exactly")],
    ["a shard missing from needs is refused", refused(swap("needs: [validation, validation-heavy-a]", "needs: [validation]").replace("          R_TWO: ${{ needs.validation-heavy-a.result }}\n", "").replace('          [ "${R_TWO:-}" = "success" ]\n', ""), "is not in")],
    ["a verdict that lets `skipped` through is refused by execution", refused(swap('[ "${R_TWO:-}" = "success" ]', '[ "${R_TWO:-}" != "failure" ]'), "verdict script is wrong")],
    ["a verdict that ignores one shard is refused by execution", refused(swap('          [ "${R_TWO:-}" = "success" ]\n', "          true\n"), "verdict script is wrong")],
    ["a verdict whose last line masks an earlier failure is refused", refused(swap('          [ "${R_TWO:-}" = "success" ]\n', '          [ "${R_TWO:-}" = "success" ] || true\n'), "verdict script is wrong")],
    ["a result bound to the wrong shard is refused", refused(swap("R_TWO: ${{ needs.validation-heavy-a.result }}", "R_TWO: ${{ needs.validation.result }}"), "exactly one must be")],
    ["the required name on a shard as well is refused", refused(swap("    name: Shard 1", `    name: ${REQUIRED}`), "exactly one, the aggregate")],
    ["the required name in a second workflow is refused", refused(good, "exactly one, the aggregate", [["b.yml", `jobs:\n  x:\n    name: ${REQUIRED}\n    timeout-minutes: 1\n`]])],
    ["the required name moved off the aggregate is refused", refused(swap(`    name: ${REQUIRED}`, "    name: Something else"), "moved off the aggregate")],
    ["job-level continue-on-error on a shard is refused", refused(swap("    name: Shard 2\n", "    name: Shard 2\n    continue-on-error: true\n"), "job-level continue-on-error")],
    ["step-level continue-on-error in a shard is refused", refused(swap("        run: echo b", "        run: echo b\n        continue-on-error: true"), "step with continue-on-error")],
    ["a conditional shard is refused", refused(swap("    name: Shard 2\n", "    name: Shard 2\n    if: github.event_name == 'push'\n"), "job-level `if:`")],
    ["a second step in the aggregate is refused", refused(swap("  other:", "      - name: after\n        run: exit 0\n  other:"), "must be one step")],
    ["continue-on-error on the aggregate is refused", refused(swap(`    name: ${REQUIRED}\n`, `    name: ${REQUIRED}\n    continue-on-error: true\n`), "sets continue-on-error")],
    ["an unbounded aggregate is refused", refused(swap(`    name: ${REQUIRED}\n    runs-on: x\n    timeout-minutes: 5\n`, `    name: ${REQUIRED}\n    runs-on: x\n`), "no job-level timeout-minutes")],
    ["a workflow with no aggregate is refused", refused(good.replace(`  ${AGGREGATE}:`, "  renamed-gate:"), `no \`${AGGREGATE}\` job`)],
  ];
  const failed = checks.filter(([, ok]) => !ok);
  for (const [label, ok] of checks) if (!ok) console.error(`  ✗ self-test: ${label}`);
  if (failed.length > 0) {
    console.error(`\nCI shard-aggregate self-test FAILED — ${failed.length} of ${checks.length}. The gate cannot be trusted to judge the workflow.`);
    process.exit(1);
  }
  console.log(`CI shard-aggregate self-test passed — ${checks.length}/${checks.length} (a correct aggregate passes; each planted fail-open is refused).`);
}

// ── the real workflow ──────────────────────────────────────────
const files = new Map(readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).sort().map((f) => [f, readFileSync(join(DIR, f), "utf8")]));
const problems = problemsIn(files);
if (problems.length > 0) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(`\nCI shard-aggregate gate FAILED — ${problems.length} problem(s). The required check "${REQUIRED}" could pass without every shard passing.`);
  process.exit(1);
}
const gate = jobsIn(files.get(FILE)).find((j) => j.id === AGGREGATE);
const needed = needsList(gate.needs);
console.log(
  `CI shard-aggregate gate passed — "${REQUIRED}" is carried only by \`${AGGREGATE}\`, which always runs, needs ` +
    `${needed.length} shard(s) [${needed.join(", ")}], and whose verdict script exits 0 on 1 of ${RESULTS.length ** needed.length} result combinations (all success).`,
);
