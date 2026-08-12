// Lane-message channel proof — the lanes talk through git, and a message nobody
// read never reads as delivered.
//
// The simulation-request loop carries WORK between the cloud lane and the Mac
// lane. This carries the other half: what one lane needs the other to KNOW. That
// half was being couriered by the owner between two chat windows — a bus with one
// very expensive hop, and the hop is a person who is phone-first and at the
// remote office a few hours a day.
//
// Three properties are pinned, each against the failure it prevents:
//   1. IDENTITY IS DERIVED, NOT DECLARED. A lane that has to remember to set a
//      variable eventually forgets, and then messages are addressed to a lane
//      nobody reads. macOS is the Mac lane by construction; everything else is
//      the cloud lane; `SIGNALGRID_LANE` overrides, and a nonsense override is
//      ignored rather than obeyed.
//   2. A LANE CANNOT ACKNOWLEDGE ITS OWN MESSAGE. Otherwise "delivered" is
//      self-certified — the unearned affirmative in its purest form, and the same
//      defect the request loop shipped with when an all-refused result closed out
//      a request nobody had run. Verified live: this proof runs the CLI and
//      watches it refuse.
//   3. UNREAD IS REPORTED, NEVER FATAL, AND NEVER SILENT. The other lane's
//      machine is not always awake. Failing CI because somebody has not read
//      their mail would be the dishonesty running the other way; hiding the
//      unread would be the dishonesty running this way.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error — plain .mjs modules, no types by design (same as the other gates)
import { LANES, currentLane, otherLane } from "../lib/lane-identity.mjs";
// @ts-expect-error — see above
import { auditLaneMessages, MSG_DIR, ACK_DIR } from "../lane-message.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("Lane-message channel proof");

// ── 1. identity is derived, and the derivation is the one documented ─────────
check("there are exactly two lanes, and the set is frozen", LANES.length === 2 && Object.isFrozen(LANES));
check("the lanes are cloud and mac", JSON.stringify([...LANES].sort()) === JSON.stringify(["cloud", "mac"]));
check(
  "identity is derived from the platform — this machine reports the lane its OS makes it",
  currentLane() === (process.platform === "darwin" ? "mac" : "cloud"),
);
check("otherLane is an involution — no message can be addressed nowhere", otherLane(otherLane("mac")) === "mac" && otherLane(otherLane("cloud")) === "cloud");
check("every lane has an other, and it is never itself", LANES.every((l: string) => LANES.includes(otherLane(l)) && otherLane(l) !== l));

// The override exists for the case the platform rule is wrong (a second Mac, a
// Linux workstation acting as the local lane) — but a TYPO in it must not create
// a third lane, so an unrecognised value falls back to the derivation.
const laneUnder = (env: Record<string, string>): string => {
  const r = spawnSync("node", ["-e", "import('./scripts/lib/lane-identity.mjs').then(m=>console.log(m.currentLane()))"], {
    cwd: repo, encoding: "utf8", env: { ...process.env, ...env },
  });
  return `${r.stdout ?? ""}`.trim();
};
const derived = process.platform === "darwin" ? "mac" : "cloud";
check("SIGNALGRID_LANE overrides the derivation when it names a real lane", laneUnder({ SIGNALGRID_LANE: "mac" }) === "mac" && laneUnder({ SIGNALGRID_LANE: "cloud" }) === "cloud");
check("…and a nonsense override is IGNORED, not obeyed — a typo cannot invent a lane", laneUnder({ SIGNALGRID_LANE: "orbit" }) === derived);
check("…and an empty override falls back to the derivation", laneUnder({ SIGNALGRID_LANE: "" }) === derived);

// ── 2. the audit's laws, each against its own failure ────────────────────────
type Msg = { id: string; __fileId: string; from: string; to: string; subject: string; body: string };
const msg = (id: string, from: string, to: string, extra: Partial<Msg> = {}): Msg =>
  ({ id, __fileId: id, from, to, subject: "s", body: "b", ...extra });
const ack = (id: string, by: string) => ({ messageId: id, __fileId: id, ackedBy: by });

const clean = auditLaneMessages([msg("m1", "cloud", "mac")], [ack("m1", "mac")]);
check("a delivered-and-acknowledged message is clean (the pass is not vacuous)", clean.problems.length === 0 && clean.unread.length === 0);

const selfAck = auditLaneMessages([msg("m1", "cloud", "mac")], [ack("m1", "cloud")]);
check(
  "A LANE CANNOT ACKNOWLEDGE ITS OWN MESSAGE — the sender's ack is refused AND the message stays unread",
  selfAck.problems.some((p: string) => p.includes("addressed to")) && selfAck.unread.length === 1,
);

const unread = auditLaneMessages([msg("m1", "cloud", "mac")], []);
check(
  "an unacknowledged message is REPORTED as unread and does not fail the build (the other machine is not always awake)",
  unread.unread.length === 1 && unread.problems.length === 0,
);
check("…and the unread line names the id, the addressee, the sender and the subject", /^m1 → mac \(from cloud\): s$/.test(unread.unread[0]));

check("an ack for a message that was never sent is refused", auditLaneMessages([], [ack("ghost", "mac")]).problems.some((p: string) => p.includes("does not exist")));
check("a message addressed to a lane that does not exist is refused", auditLaneMessages([msg("m1", "cloud", "orbit")], []).problems.some((p: string) => p.includes("not a known lane")));
check("a message addressed to its own sender is refused (it would be unreadable by construction)", auditLaneMessages([msg("m1", "cloud", "cloud")], []).problems.some((p: string) => p.includes("its own sender")));
check(
  "AN EMPTY BODY IS REFUSED — a message that says nothing still looks answered",
  auditLaneMessages([msg("m1", "cloud", "mac", { body: "   " })], []).problems.some((p: string) => p.includes("no body")),
);
check("a missing subject is refused", auditLaneMessages([msg("m1", "cloud", "mac", { subject: "" })], []).problems.some((p: string) => p.includes("no subject")));
check(
  "an id that disagrees with its filename is refused — the ack binds on id, so a mismatch acks the wrong thing",
  auditLaneMessages([{ ...msg("m1", "cloud", "mac"), __fileId: "different" }], []).problems.some((p: string) => p.includes("does not match its filename")),
);

// ── 3. the CLI enforces it live, not just the pure audit ─────────────────────
// Every invocation below is read-only or refuses before writing, so running the
// proof never mutates the committed channel.
const cli = (args: string[], env: Record<string, string> = {}) => {
  const r = spawnSync("node", ["scripts/lane-message.mjs", ...args], {
    cwd: repo, encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 8 * 1024 * 1024,
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};

const before = existsSync(ACK_DIR) ? readdirSync(ACK_DIR).sort().join(",") : "";
const committed = existsSync(MSG_DIR)
  ? readdirSync(MSG_DIR).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(MSG_DIR, f), "utf8")))
  : [];
check("at least one message is committed (the channel is live, not theoretical)", committed.length > 0);

const someone = committed[0];
if (someone) {
  const asSender = cli(["ack", someone.id], { SIGNALGRID_LANE: someone.from });
  check(
    "LIVE: the CLI refuses when the SENDER tries to acknowledge, and says whose mail it is",
    asSender.code === 2 && asSender.out.includes("Refusing to acknowledge somebody else's mail"),
  );
  check("…and that refusal wrote nothing", (existsSync(ACK_DIR) ? readdirSync(ACK_DIR).sort().join(",") : "") === before);
}
check("LIVE: acknowledging a message that does not exist is refused", cli(["ack", "no-such-message-id"]).code === 2);
check("LIVE: send with no body is refused rather than writing an empty message", cli(["send", "subject-only"]).code === 2);
check("LIVE: an unknown command is refused (a typo must not read as success)", cli(["deliverr"]).code === 2);
check("LIVE: --id with no value is refused rather than swallowing the subject", cli(["send", "--id"]).code === 2);
check("LIVE: an id that slugs away to nothing is refused, not written as \".json\"", cli(["send", "--id", "../../", "s", "b"]).code === 2);

// The id becomes a FILENAME, and the sending lane is not always the lane that
// authored the string, so it is slugged unconditionally — `../../x` becomes `x`.
const cliSrc = readFileSync(join(repo, "scripts/lane-message.mjs"), "utf8");
check(
  "every id that reaches the filesystem is slugged first — a path separator cannot escape the channel directory",
  /const id = slug\(/.test(cliSrc) && /join\(ACK_DIR, `\$\{slug\(messageId\)\}\.json`\)/.test(cliSrc) &&
    /\.replace\(\/\[\^a-z0-9\]\+\/g, "-"\)/.test(cliSrc),
);
check("the module does not run its CLI on import — the gate and this proof import it for the audit", /if \(process\.argv\[1\] && resolve\(process\.argv\[1\]\) === fileURLToPath\(import\.meta\.url\)\) runCli\(\)/.test(cliSrc));
check(
  "LIVE: the inbox names the lane it believes it is, so a misread identity is visible rather than silent",
  cli(["inbox"], { SIGNALGRID_LANE: "mac" }).out.includes("this machine is the MAC lane"),
);

// ── 4. the gate itself can fail, and the committed channel is coherent ───────
const selfTest = spawnSync("node", ["scripts/check-lane-messages.mjs", "--self-test"], { cwd: repo, encoding: "utf8" });
check("the gate's own self-test passes — the gate is capable of failing and does not", selfTest.status === 0);

const load = (dir: string) =>
  (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : []).map((f) => {
    const p = JSON.parse(readFileSync(join(dir, f), "utf8"));
    p.__fileId = f.replace(/\.json$/, "");
    return p;
  });
const live = auditLaneMessages(load(MSG_DIR), load(ACK_DIR));
check("the committed message/ack set has no incoherence", live.problems.length === 0);
check("every committed message declares a schema version (the channel is versioned, not ad hoc)", load(MSG_DIR).every((m: { schemaVersion?: number }) => m.schemaVersion === 1));

const total = passed + failures.length;
console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
console.log(`figures=lanes=${LANES.length},messages=${load(MSG_DIR).length},acknowledged=${live.ackedIds.size},unread=${live.unread.length}`);
if (failures.length > 0) {
  console.error("Failed checks:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
