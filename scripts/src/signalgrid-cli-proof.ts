// Proof: the `signalgrid` CLI (artifacts/signalgrid-cli) over the REAL /v1 API.
//
// Boots the built api-server on an OS-assigned port, puts a recording proxy in
// front of it (also on an OS-assigned port), and runs the CLI as a subprocess —
// the way an agent runs it — through every subcommand in both output modes.
//
// What is asserted, and why each one can fail:
//   · Every read subcommand, human and --json, exits 0 and prints what /v1 says —
//     compared against the server's own answer fetched directly, not a constant.
//   · READ-ONLY BY DEFAULT: across every run without --allow-write, the proxy sees
//     NO request other than GET, and the server's own counts (decisions, audit
//     ledger length, a connector's sync runs) do not move. A write subcommand
//     without the flag sends nothing at all and exits 4.
//   · With --allow-write, exactly the one expected POST happens, and the printed
//     outcome is the one the server recorded.
//   · FAIL CLOSED: a missing token, an unreachable server, a revoked token, a
//     tenant mismatch, and a server that answers 200 with no verdict each exit
//     non-zero with a message naming the cause, and none prints an outcome.
//   · The session file never holds the token and is refused inside the tree.
//   · The committed .claude/skills/cli-anything/signalgrid-cli/SKILL.md equals the generator.
//
// Offline and public-safe: the in-memory demo core and synthetic demo keys only.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const serverEntry = resolve(repoRoot, "artifacts/api-server/dist/index.mjs");
const cliDir = resolve(repoRoot, "artifacts/signalgrid-cli");
const cliBin = resolve(cliDir, "src/bin.ts");
const skillPath = resolve(repoRoot, ".claude/skills/cli-anything/signalgrid-cli/SKILL.md");
const TOKEN = "sgk_demo_northwind_owner";
const TENANT = "tenant_northwind";

let passed = 0;
const failures: string[] = [];
// Only the STATIC check name is ever logged — never a value taken from the CLI's
// output, a request path or a server answer (the api-server suite's rule, and what
// CodeQL's log-injection query holds this file to). `_detail` documents each check
// at its call site; reproduce a failure by running the named command yourself.
function check(name: string, ok: boolean, _detail = ""): void {
  if (ok) {
    passed += 1;
    console.log(`  ok — ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗  — ${name}`);
  }
}

function listen(server: Server): Promise<number> {
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r((server.address() as AddressInfo).port)));
}

async function freePort(): Promise<number> {
  const s = createServer();
  const port = await listen(s);
  await new Promise((r) => s.close(r));
  return port;
}

// ── the recording proxy: every request the CLI makes, by method and path ──
const seen: string[] = [];
function startProxy(upstreamPort: number): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    seen.push(`${req.method} ${(req.url ?? "").split("?")[0]}`);
    const up = httpRequest(
      { host: "127.0.0.1", port: upstreamPort, method: req.method, path: req.url, headers: req.headers },
      (upRes) => {
        res.writeHead(upRes.statusCode ?? 502, upRes.headers);
        upRes.pipe(res);
      },
    );
    up.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  return listen(server).then((port) => ({ server, port }));
}

// ── a lying server: 200 OK with no verdict, or with a word outside the four ──
function startLiar(body: unknown): Promise<{ server: Server; port: number }> {
  const server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    if ((req.url ?? "").endsWith("/v1/context")) {
      res.end(JSON.stringify({ tenant: { id: TENANT, slug: "northwind-health" } }));
    } else {
      res.end(JSON.stringify(body));
    }
  });
  return listen(server).then((port) => ({ server, port }));
}

interface Run { code: number; stdout: string; stderr: string }
// ASYNC on purpose: the recording proxy and the lying servers live in THIS process,
// so a spawnSync would block the event loop that has to answer the CLI.
function cli(args: string[], env: Record<string, string>): Promise<Run> {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, ["--import", "tsx", cliBin, ...args], {
      cwd: cliDir,
      env: { PATH: process.env["PATH"] ?? "", ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b: Buffer) => { stdout += b.toString("utf8"); });
    child.stderr.on("data", (b: Buffer) => { stderr += b.toString("utf8"); });
    const timer = setTimeout(() => child.kill(), 30_000);
    child.on("close", (code) => { clearTimeout(timer); resolveRun({ code: code ?? -1, stdout, stderr }); });
  });
}
function parse(stdout: string): Record<string, unknown> | null {
  try { return JSON.parse(stdout) as Record<string, unknown>; } catch { return null; }
}

async function direct(base: string, path: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  return (await res.json()) as Record<string, unknown>;
}

async function main(): Promise<void> {
  console.log("== Proof: signalgrid CLI (read-only by default, fail-closed, dual output) ==");
  if (!existsSync(serverEntry)) {
    const b = spawnSync("pnpm", ["--filter", "@workspace/api-server", "run", "build"], { cwd: repoRoot, stdio: "inherit" });
    if (b.status !== 0) throw new Error("api-server build failed; the proof cannot run");
  }
  const apiPort = await freePort();
  const api: ChildProcess = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, PORT: String(apiPort), LOG_LEVEL: "silent", DATABASE_URL: "", NODE_ENV: "development" },
    stdio: ["ignore", "ignore", "inherit"],
  });
  const proxy = await startProxy(apiPort);
  const DIRECT = `http://127.0.0.1:${apiPort}/api`;
  const VIA = `http://127.0.0.1:${proxy.port}/api`;
  const env = { SIGNALGRID_BASE_URL: VIA, SIGNALGRID_TENANT: "northwind-health", SIGNALGRID_TOKEN: TOKEN };
  const liars: Server[] = [];
  const sessionDir = mkdtempSync(join(tmpdir(), "signalgrid-cli-proof-"));
  try {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      try { ready = (await fetch(`${DIRECT}/healthz`)).ok; } catch { /* not up yet */ }
      if (!ready) await new Promise((r) => setTimeout(r, 250));
    }
    check("api-server harness is up on an OS-assigned port", ready);
    if (!ready) return;

    const decisions = await direct(DIRECT, "/v1/decisions");
    const seedId = ((decisions["decisions"] as Record<string, unknown>[])[0]!)["id"] as string;
    const seedRec = await direct(DIRECT, `/v1/decisions/${seedId}`);
    const seedOutcome = (seedRec["decision"] as Record<string, unknown>)["outcome"] as string;
    const seedEv = await direct(DIRECT, `/v1/decisions/${seedId}/evidence`);
    const seedSignals = ((seedEv["evidence"] as Record<string, unknown>)["signalsUsed"] as unknown[]).length;
    const connList = (await direct(DIRECT, "/v1/connectors"))["connectors"] as Record<string, unknown>[];
    const connId = connList[0]!["id"] as string;

    const counts = async () => ({
      decisions: (await direct(DIRECT, "/v1/decisions"))["total"] as number,
      audit: ((await direct(DIRECT, "/v1/audit"))["chain"] as Record<string, unknown>)["length"] as number,
    });
    // Sync-run ids are deterministic under the fixed clock, so a fixture sync REPLACES
    // its run rather than adding one: the run count cannot see a sync write. The
    // recording proxy is what proves an un-flagged sync sent nothing.
    const runsBefore = ((await direct(DIRECT, `/v1/connectors/${connId}/sync-runs`))["syncRuns"] as unknown[]).length;
    const before = await counts();

    // ── every read subcommand, both modes, and no write anywhere ──
    seen.length = 0;
    const reads: Array<{ name: string; args: string[]; human: (s: string) => boolean; json: (j: Record<string, unknown>) => boolean }> = [
      {
        name: "explain", args: ["explain", seedId],
        human: (s) => s.includes(`outcome     ${seedOutcome}`) && s.includes("digest verifies"),
        json: (j) => (j["decision"] as Record<string, unknown>)?.["outcome"] === seedOutcome && j["evidenceVerified"] === true,
      },
      {
        name: "signals", args: ["signals", seedId],
        human: (s) => s.startsWith(`${seedSignals} signals for ${seedId}`),
        json: (j) => Array.isArray(j["signals"]) && (j["signals"] as unknown[]).length === seedSignals,
      },
      {
        name: "audit", args: ["audit", "--limit", "3"],
        human: (s) => s.startsWith(`chain valid · length ${before.audit}`) && s.includes("showing 3"),
        json: (j) => (j["chain"] as Record<string, unknown>)?.["valid"] === true && (j["events"] as unknown[]).length === 3,
      },
      {
        name: "connectors", args: ["connectors"],
        human: (s) => connList.every((c) => s.includes(c["id"] as string)),
        json: (j) => (j["connectors"] as unknown[]).length === connList.length,
      },
      {
        name: "connectors runs", args: ["connectors", "runs", connId],
        human: (s) => s.trimEnd().split("\n").length === 2 + runsBefore,
        json: (j) => (j["syncRuns"] as unknown[]).length === runsBefore,
      },
    ];
    for (const r of reads) {
      const h = await cli(r.args, env);
      check(`${r.name} (human) exits 0 and prints what /v1 answered`, h.code === 0 && r.human(h.stdout), `exit ${h.code} ${h.stderr.trim()}`);
      const j = await cli([...r.args, "--json"], env);
      const parsed = parse(j.stdout);
      check(`${r.name} (--json) exits 0 with one JSON object carrying the same facts`, j.code === 0 && parsed?.["ok"] === true && r.json(parsed), `exit ${j.code}`);
    }
    check("the read subcommands made GET requests only", seen.length > 0 && seen.every((s) => s.startsWith("GET ")), seen.filter((s) => !s.startsWith("GET ")).join(", "));

    // ── write subcommands without the flag: nothing is sent at all ──
    seen.length = 0;
    const decideArgs = ["decide", "--identity", "nurse.compliant", "--device", "ipad-ward-01", "--workflow", "clinical-session"];
    for (const mode of [[], ["--json"]]) {
      const d = await cli([...decideArgs, ...mode], env);
      const label = mode.length ? "--json" : "human";
      check(`decide (${label}) without --allow-write exits 4 and says NOT SENT`, d.code === 4 && (mode.length ? parse(d.stdout)?.["sent"] === false : d.stdout.startsWith("NOT SENT")), `exit ${d.code}`);
      check(`decide (${label}) without --allow-write prints no outcome`, !/outcome/.test(d.stdout));
      const s = await cli(["connectors", "sync", connId, ...mode], env);
      check(`connectors sync (${label}) without --allow-write exits 4`, s.code === 4, `exit ${s.code}`);
    }
    check("no request of any kind reached the server from an un-flagged write", seen.length === 0, seen.join(", "));
    const afterReads = await counts();
    check("decision count and audit ledger are unchanged after every un-flagged run",
      JSON.stringify(afterReads) === JSON.stringify(before), `${JSON.stringify(before)} → ${JSON.stringify(afterReads)}`);

    // ── with the flag: exactly the expected write, and the printed verdict is the recorded one ──
    const sessionFile = join(sessionDir, "session.json");
    seen.length = 0;
    const w = await cli([...decideArgs, "--allow-write", "--json"], { ...env, SIGNALGRID_CLI_SESSION: sessionFile });
    const wj = parse(w.stdout);
    const minted = (wj?.["decision"] as Record<string, unknown> | undefined)?.["decisionId"] as string | undefined;
    check("decide --allow-write (--json) exits 0 and sends exactly one POST /v1/decisions/evaluate",
      w.code === 0 && seen.filter((s) => !s.startsWith("GET ")).join() === "POST /api/v1/decisions/evaluate", `exit ${w.code} ${seen.join(", ")}`);
    const recorded = minted ? await direct(DIRECT, `/v1/decisions/${minted}`) : {};
    check("the outcome decide printed is the outcome the server recorded",
      !!minted && (wj?.["decision"] as Record<string, unknown>)["outcome"] === (recorded["decision"] as Record<string, unknown> | undefined)?.["outcome"]);
    const wh = await cli([...decideArgs, "--allow-write"], env);
    check("decide --allow-write (human) exits 0 and prints the outcome line", wh.code === 0 && /^outcome\s+(allow|step_up|restrict|deny)$/m.test(wh.stdout), `exit ${wh.code}`);
    seen.length = 0;
    const sy = await cli(["connectors", "sync", connId, "--allow-write", "--json"], env);
    check("connectors sync --allow-write exits 0 and sends exactly one POST",
      sy.code === 0 && seen.filter((s) => !s.startsWith("GET ")).join() === `POST /api/v1/connectors/${connId}/sync`, `exit ${sy.code}`);
    const syh = await cli(["connectors", "sync", connId, "--allow-write"], env);
    check("connectors sync --allow-write (human) exits 0", syh.code === 0 && syh.stdout.startsWith("sync run "), `exit ${syh.code}`);
    const afterWrites = await counts();
    check("the flagged decides moved the server's counts (the counts can see a write)",
      afterWrites.decisions === before.decisions + 2 && afterWrites.audit > before.audit,
      `${JSON.stringify(before)} → ${JSON.stringify(afterWrites)}`);
    const runId = (parse(sy.stdout)?.["syncRun"] as Record<string, unknown> | undefined)?.["id"];
    const runsNow = (await direct(DIRECT, `/v1/connectors/${connId}/sync-runs`))["syncRuns"] as Record<string, unknown>[];
    check("the sync run connectors sync printed is one the server lists", typeof runId === "string" && runsNow.some((r) => r["id"] === runId));

    // ── the session: follows a decide, never holds the token, never in the tree ──
    const sessionText = existsSync(sessionFile) ? readFileSync(sessionFile, "utf8") : "";
    check("the session file records the minted decision id and never the token", !!minted && sessionText.includes(minted) && !sessionText.includes(TOKEN));
    const ex = await cli(["explain", "--json"], { ...env, SIGNALGRID_CLI_SESSION: sessionFile });
    check("explain with no id follows the session's last decision", ex.code === 0 && (parse(ex.stdout)?.["decision"] as Record<string, unknown> | undefined)?.["id"] === minted, `exit ${ex.code}`);
    seen.length = 0;
    const traversal = await cli(["explain", "../connectors"], env);
    check("a decision id shaped like a path is refused before any request (exit 2)",
      traversal.code === 2 && /not a well-formed id/.test(traversal.stderr) && seen.length === 0, `exit ${traversal.code} ${seen.join(", ")}`);
    const poisoned = join(sessionDir, "poisoned.json");
    writeFileSync(poisoned, JSON.stringify({ version: 1, baseUrl: VIA, tenant: "northwind-health", lastDecisionId: "x/../../v1/connectors" }));
    seen.length = 0;
    const pz = await cli(["explain"], { ...env, SIGNALGRID_CLI_SESSION: poisoned });
    check("a session file holding a malformed decision id is refused, not followed",
      pz.code === 2 && /not a well-formed id/.test(pz.stderr) && !seen.some((x) => x.includes("connectors")), `exit ${pz.code} ${seen.join(", ")}`);
    const inTree = await cli(["explain"], { ...env, SIGNALGRID_CLI_SESSION: join(repoRoot, "signalgrid-session.json") });
    check("a session path inside the repository is refused (exit 2)", inTree.code === 2 && /outside the tree/.test(inTree.stderr), `exit ${inTree.code}`);

    // ── fail closed ──
    seen.length = 0;
    for (const mode of [[], ["--json"]]) {
      const label = mode.length ? "--json" : "human";
      const noTok = await cli(["audit", ...mode], { SIGNALGRID_BASE_URL: VIA, SIGNALGRID_TENANT: "northwind-health" });
      const noTokText = noTok.stdout + noTok.stderr;
      check(`missing token (${label}) exits 2, names SIGNALGRID_TOKEN, prints no result`,
        noTok.code === 2 && noTokText.includes("SIGNALGRID_TOKEN") && !noTokText.includes("chain valid") && parse(noTok.stdout)?.["ok"] !== true, `exit ${noTok.code}`);
    }
    check("a missing token sent no request", seen.length === 0, seen.join(", "));
    const deadPort = await freePort();
    for (const mode of [[], ["--json"]]) {
      const label = mode.length ? "--json" : "human";
      const un = await cli(["explain", seedId, ...mode], { ...env, SIGNALGRID_BASE_URL: `http://127.0.0.1:${deadPort}/api` });
      const unText = un.stdout + un.stderr;
      check(`unreachable server (${label}) exits 3, says so, prints no outcome`,
        un.code === 3 && /could not reach/.test(unText) && !/outcome\s/.test(unText) && parse(un.stdout)?.["ok"] !== true, `exit ${un.code}`);
    }
    const bad = await cli(["connectors"], { ...env, SIGNALGRID_TOKEN: "sgk_not_a_key" });
    check("a revoked or unknown token exits 1 with the server's 401", bad.code === 1 && /HTTP 401/.test(bad.stderr), `exit ${bad.code}`);
    seen.length = 0;
    const mism = await cli(["audit"], { ...env, SIGNALGRID_TENANT: "tenant_atlas" });
    check("a tenant mismatch exits 2 and requests nothing beyond /v1/context",
      mism.code === 2 && /belongs to "tenant_northwind"/.test(mism.stderr) && seen.join() === "GET /api/v1/context", `exit ${mism.code} ${seen.join(", ")}`);
    const plain = await cli(["connectors"], { ...env, SIGNALGRID_BASE_URL: "http://example.invalid/api" });
    check("a plaintext non-loopback base URL is refused before any request (exit 2)", plain.code === 2, `exit ${plain.code}`);
    for (const [label, body] of [["no verdict", {}], ["a word outside the four", { decision: { decisionId: "dec_x", outcome: "probably_fine" } }]] as const) {
      const liar = await startLiar(body);
      liars.push(liar.server);
      const r = await cli([...decideArgs, "--allow-write"], { ...env, SIGNALGRID_BASE_URL: `http://127.0.0.1:${liar.port}/api` });
      check(`a 200 carrying ${label} is not a success: decide exits 1 and prints no outcome`,
        r.code === 1 && !/^outcome/m.test(r.stdout) && /without a recognisable outcome/.test(r.stderr), `exit ${r.code}`);
    }

    // A liar that answers every non-context route with `body`; each case is one lie the
    // CLI must refuse to report as a clean answer (review round 1 on PR #1321).
    const viaLiar = async (body: unknown, args: string[]) => {
      const liar = await startLiar(body);
      liars.push(liar.server);
      return cli(args, { ...env, SIGNALGRID_BASE_URL: `http://127.0.0.1:${liar.port}/api` });
    };
    const oov = await viaLiar(
      { decision: { id: "dec_x", outcome: "probably_fine" }, evidence: { signalsUsed: [] }, verified: true },
      ["explain", "dec_x"],
    );
    check("explain refuses a recorded outcome outside the four words (exit 1, no outcome line)",
      oov.code === 1 && !/^outcome/m.test(oov.stdout) && /no recognisable outcome/.test(oov.stderr));
    const unverified = { decision: { id: "dec_x", outcome: "allow" }, evidence: { signalsUsed: [{ category: "identity_state" }] }, verified: false };
    const exU = await viaLiar(unverified, ["explain", "dec_x"]);
    check("explain on evidence that does not verify exits 1 and says so",
      exU.code === 1 && /DOES NOT VERIFY/.test(exU.stdout));
    const exUj = await viaLiar(unverified, ["explain", "dec_x", "--json"]);
    check("explain --json on unverifiable evidence exits 1 with ok:false",
      exUj.code === 1 && parse(exUj.stdout)?.["ok"] === false && parse(exUj.stdout)?.["evidenceVerified"] === false);
    const sgU = await viaLiar(unverified, ["signals", "dec_x"]);
    check("signals on evidence that does not verify exits 1 and says so",
      sgU.code === 1 && /DOES NOT VERIFY/.test(sgU.stdout));
    const broken = await viaLiar({ events: [{ seq: 1, type: "decision.evaluated" }], chain: { valid: false, brokenAtSeq: 1, length: 1 }, source: "memory" }, ["audit"]);
    check("audit on a broken ledger chain exits 1 and names the break",
      broken.code === 1 && /BROKEN at seq 1/.test(broken.stdout));
    const brokenJ = await viaLiar({ events: [], chain: { valid: false, brokenAtSeq: 1, length: 1 } }, ["audit", "--json"]);
    check("audit --json on a broken chain exits 1 with ok:false", brokenJ.code === 1 && parse(brokenJ.stdout)?.["ok"] === false);
    const emptyRun = await viaLiar({ syncRun: {} }, ["connectors", "sync", "conn_x", "--allow-write"]);
    check("connectors sync refuses a sync run with no id or status (exit 1)",
      emptyRun.code === 1 && !/^sync run /m.test(emptyRun.stdout));

    // The write path's tenant check: the wrong credential must not mint a decision.
    seen.length = 0;
    const beforeMism = await counts();
    const wMism = await cli([...decideArgs, "--allow-write"], { ...env, SIGNALGRID_TENANT: "tenant_atlas" });
    const afterMism = await counts();
    check("decide --allow-write under a tenant mismatch exits 2 and sends no POST",
      wMism.code === 2 && seen.join() === "GET /api/v1/context" && afterMism.decisions === beforeMism.decisions);

    // A symlink outside the tree that points INTO it must not carry the session inside.
    const link = join(sessionDir, "into-repo");
    symlinkSync(repoRoot, link);
    const viaLink = await cli(["explain"], { ...env, SIGNALGRID_CLI_SESSION: join(link, "signalgrid-session.json") });
    check("a session path that reaches the repository through a symlink is refused (exit 2)",
      viaLink.code === 2 && /outside the tree/.test(viaLink.stderr) && !existsSync(join(repoRoot, "signalgrid-session.json")));

    // ── review round 2 on PR #1321 ──
    // A bad session must refuse BEFORE decide sends anything: exit 2 means nothing was sent.
    const lockedSession = join(sessionDir, "locked.json");
    writeFileSync(`${lockedSession}.lock`, "");
    const badSessions: Array<[string, string]> = [
      ["inside the repository", join(repoRoot, "signalgrid-session.json")],
      ["relative", "relative-session.json"],
      ["in a directory that does not exist", join(sessionDir, "no-such-dir", "s.json")],
      ["locked by another process", lockedSession],
    ];
    for (const [label, sessionValue] of badSessions) {
      seen.length = 0;
      const beforeBad = await counts();
      const r = await cli([...decideArgs, "--allow-write", "--json"], { ...env, SIGNALGRID_CLI_SESSION: sessionValue });
      const afterBad = await counts();
      check(`decide --allow-write with a session ${label} exits 2 and sends no POST`,
        r.code === 2 && !seen.some((x) => x.startsWith("POST ")) && afterBad.decisions === beforeBad.decisions);
    }
    rmSync(`${lockedSession}.lock`, { force: true });

    // Every command confirms the tenant, not only audit and decide.
    for (const [label, args] of [
      ["connectors sync --allow-write", ["connectors", "sync", connId, "--allow-write"]],
      ["explain", ["explain", seedId]],
      ["signals", ["signals", seedId]],
      ["connectors runs", ["connectors", "runs", connId]],
      ["connectors", ["connectors"]],
    ] as const) {
      seen.length = 0;
      const r = await cli([...args], { ...env, SIGNALGRID_TENANT: "tenant_atlas" });
      check(`${label} under a tenant mismatch exits 2 and requests nothing beyond /v1/context`,
        r.code === 2 && seen.join() === "GET /api/v1/context");
    }

    // An ABSENT verdict field is not a passing one.
    const noVerified = await viaLiar({ decision: { id: "dec_x", outcome: "allow" }, evidence: { signalsUsed: [] } }, ["explain", "dec_x"]);
    check("explain with no `verified` field in the evidence answer exits 1", noVerified.code === 1);
    const noVerifiedSignals = await viaLiar({ evidence: { signalsUsed: [] } }, ["signals", "dec_x"]);
    check("signals with no `verified` field exits 1", noVerifiedSignals.code === 1);
    const noValid = await viaLiar({ events: [], chain: { length: 0 } }, ["audit"]);
    check("audit with no `chain.valid` field exits 1", noValid.code === 1);

    // decide refuses a decision id the server should never mint.
    const badId = await viaLiar({ decision: { decisionId: "../x", outcome: "allow" } }, [...decideArgs, "--allow-write"]);
    check("decide refuses a server-minted decision id outside the id shape (exit 1)", badId.code === 1 && !/^outcome/m.test(badId.stdout));

    // A body that drops mid-read is no answer at all: exit 3, never a partial success.
    const dropper = createServer((req, res) => {
      if ((req.url ?? "").endsWith("/v1/context")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ tenant: { id: TENANT, slug: "northwind-health" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json", "content-length": "4096" });
      res.write('{"connectors":[');
      setTimeout(() => res.socket?.destroy(), 20);
    });
    const dropPort = await listen(dropper);
    liars.push(dropper);
    const drop = await cli(["connectors"], { ...env, SIGNALGRID_BASE_URL: `http://127.0.0.1:${dropPort}/api` });
    check("a body that drops mid-read exits 3 (unreachable), not 0 or 1", drop.code === 3);

    // Credentials typed into the base URL never reach the output.
    const secretPort = await freePort();
    const leaky = await cli(["connectors", "--json"], { ...env, SIGNALGRID_BASE_URL: `http://operator:SECRETPW@127.0.0.1:${secretPort}/api` });
    check("userinfo in SIGNALGRID_BASE_URL is never echoed in an error",
      leaky.code !== 0 && !(leaky.stdout + leaky.stderr).includes("SECRETPW"));

    // ── review round 3 on PR #1321 ──
    // A symlink planted at `<session>.tmp` is never followed: not over an outside file,
    // and not into the repository.
    const victimDir = mkdtempSync(join(tmpdir(), "signalgrid-cli-victim-"));
    const victim = join(victimDir, "victim.txt");
    writeFileSync(victim, "VICTIM");
    const s7 = join(sessionDir, "s7.json");
    symlinkSync(victim, `${s7}.tmp`);
    const clobber = await cli([...decideArgs, "--allow-write", "--json"], { ...env, SIGNALGRID_CLI_SESSION: s7 });
    const s7Id = (parse(clobber.stdout)?.["decision"] as Record<string, unknown> | undefined)?.["decisionId"];
    check("a symlink planted at <session>.tmp is not followed: the outside file is untouched",
      clobber.code === 0 && readFileSync(victim, "utf8") === "VICTIM");
    check("…and the session lands as a regular file holding the decision",
      existsSync(s7) && !lstatSync(s7).isSymbolicLink() && typeof s7Id === "string" && readFileSync(s7, "utf8").includes(s7Id));
    const leak = join(repoRoot, "signalgrid-cli-tmpleak.json");
    const s7b = join(sessionDir, "s7b.json");
    symlinkSync(leak, `${s7b}.tmp`);
    const intoRepo = await cli([...decideArgs, "--allow-write"], { ...env, SIGNALGRID_CLI_SESSION: s7b });
    check("a symlink at <session>.tmp pointing into the repository writes nothing there",
      intoRepo.code === 0 && !existsSync(leak));
    rmSync(victimDir, { recursive: true, force: true });

    // A session path that is a directory is refused before anything is sent.
    const dirSession = join(sessionDir, "a-directory");
    mkdirSync(dirSession);
    seen.length = 0;
    const isDir = await cli([...decideArgs, "--allow-write"], { ...env, SIGNALGRID_CLI_SESSION: dirSession });
    check("a session path that is a directory exits 2 and sends no POST",
      isDir.code === 2 && !seen.some((x) => x.startsWith("POST ")));

    // A session write that fails AFTER the POST keeps the verdict and warns; it never
    // hides a decision the server has recorded behind an error exit.
    const s8 = join(sessionDir, "s8.json");
    mkdirSync(`${s8}.tmp`);
    seen.length = 0;
    const late = await cli([...decideArgs, "--allow-write", "--json"], { ...env, SIGNALGRID_CLI_SESSION: s8 });
    const lateJ = parse(late.stdout);
    check("a session write that fails after the POST still reports the decision (exit 0, sessionWarning, stderr warning)",
      late.code === 0 && seen.includes("POST /api/v1/decisions/evaluate") &&
      typeof (lateJ?.["decision"] as Record<string, unknown> | undefined)?.["decisionId"] === "string" &&
      typeof lateJ?.["sessionWarning"] === "string" && /warning:/.test(late.stderr));

    // ── help and the generated SKILL.md ──
    const help = await cli(["--help"], {});
    check("--help lists all five subcommands", help.code === 0 && ["decide", "explain", "signals", "audit", "connectors"].every((c) => help.stdout.includes(`signalgrid ${c}`)));
    const gen = await cli(["skill"], {});
    const committed = existsSync(skillPath) ? readFileSync(skillPath, "utf8") : "";
    check(".claude/skills/cli-anything/signalgrid-cli/SKILL.md equals `signalgrid skill` (regenerate: signalgrid skill > that path)",
      gen.code === 0 && gen.stdout.length > 0 && gen.stdout === committed);
    // scripts/check-skill-plane-conformance.mjs walks .claude/skills/*/SKILL.md one level deep, so
    // this nested skill is outside its walk; its three rules are held here instead, not waived.
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(committed)?.[1] ?? "";
    const fmName = /^name:\s*(.+)$/m.exec(fm)?.[1]?.trim();
    const fmDesc = /^description:\s*(.+)$/m.exec(fm)?.[1]?.trim();
    check("the generated SKILL.md meets the skill-plane shape: a name equal to its directory and a non-empty description",
      fmName === "signalgrid-cli" && fmName === dirname(skillPath).split("/").pop() && !!fmDesc);
  } finally {
    api.kill();
    proxy.server.close();
    for (const l of liars) l.close();
    rmSync(sessionDir, { recursive: true, force: true });
  }
}

await main();
console.log(`\n${passed}/${passed + failures.length} checks passed`);
if (failures.length > 0) {
  console.log(`FAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("✅ signalgrid CLI proof passed");
