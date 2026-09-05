// check-lane-messages.mjs — a message nobody read is not a message that was sent.
//
//   node scripts/check-lane-messages.mjs              # report + gate
//   node scripts/check-lane-messages.mjs --self-test  # prove the gate can fail
//
// Sibling of `check-sim-requests.mjs`, and deliberately the same shape, because
// it enforces the same law one layer over: the request loop refuses to let an
// UNRUN operation read as green, and this refuses to let an UNREAD message read
// as delivered. Both failures look identical from the sending side — silence —
// and both are the unearned affirmative wearing a different hat.
//
// UNREAD IS REPORTED, NEVER FATAL. The other lane's machine is not always awake,
// and failing the build because somebody has not read their mail would be the
// dishonesty running the other way. Only INCOHERENCE fails: a message addressed
// to a lane that does not exist, an ack for a message that was never sent, or an
// ack written by anyone other than the addressee — which would be a lane marking
// its own message read.
import { auditLaneMessages, loadMessages, loadAcks } from "./lane-message.mjs";

function selfTest() {
  const checks = [];
  const msg = (id, from, to, extra = {}) => ({ id, __fileId: id, from, to, subject: "s", body: "b", ...extra });
  const ack = (id, by) => ({ messageId: id, __fileId: id, ackedBy: by });

  let a = auditLaneMessages([msg("m1", "cloud", "mac")], [ack("m1", "mac")]);
  checks.push(["a delivered-and-acknowledged message is clean", a.problems.length === 0 && a.unread.length === 0]);

  a = auditLaneMessages([msg("m1", "cloud", "mac")], []);
  checks.push(["an unacknowledged message is UNREAD, and unread is not a failure", a.unread.length === 1 && a.problems.length === 0]);

  a = auditLaneMessages([msg("m1", "cloud", "mac")], [ack("m1", "cloud")]);
  checks.push([
    "A LANE CANNOT ACKNOWLEDGE ITS OWN MESSAGE — the sender acking is refused, and it stays unread",
    a.problems.some((p) => p.includes("addressed to")) && a.unread.length === 1,
  ]);

  a = auditLaneMessages([], [ack("ghost", "mac")]);
  checks.push(["an ack for a message that does not exist is caught", a.problems.some((p) => p.includes("does not exist"))]);

  a = auditLaneMessages([msg("m1", "cloud", "orbit")], []);
  checks.push(["an unknown lane is caught", a.problems.some((p) => p.includes("not a known lane"))]);

  a = auditLaneMessages([msg("m1", "cloud", "cloud")], []);
  checks.push(["a message addressed to its own sender is caught", a.problems.some((p) => p.includes("its own sender"))]);

  a = auditLaneMessages([msg("m1", "cloud", "mac", { body: "   " })], []);
  checks.push(["an empty body is caught — it looks answered and says nothing", a.problems.some((p) => p.includes("no body"))]);

  a = auditLaneMessages([{ id: "m1", __fileId: "different", from: "cloud", to: "mac", subject: "s", body: "b" }], []);
  checks.push(["an id that disagrees with its filename is caught", a.problems.some((p) => p.includes("does not match its filename"))]);

  const T0 = Date.parse("2026-09-05T12:00:00Z");
  a = auditLaneMessages([msg("m1", "cloud", "mac", { sentAt: "2026-09-05T10:00:00Z" })], [], T0);
  checks.push(["a v2 message names how long it has waited", a.unread.length === 1 && /unread for 2\.0h$/.test(a.unread[0]) && a.stale.length === 0]);
  a = auditLaneMessages([msg("m1", "cloud", "mac", { sentAt: "2026-09-03T10:00:00Z" })], [], T0);
  checks.push(["unread beyond 24h is STALE — reported, and still not a failure", a.stale.includes("m1") && a.problems.length === 0]);
  a = auditLaneMessages([msg("m1", "cloud", "mac", { sentAt: "not-a-date" })], [], T0);
  checks.push(["an unparseable sentAt is reported as unknown age and treated as stale, never as fresh", /unknown age/.test(a.unread[0]) && a.stale.includes("m1")]);
  a = auditLaneMessages([msg("m1", "cloud", "mac")], [], T0);
  checks.push(["a v1 message (no sentAt) keeps its exact line — age is honestly unknown, not invented", a.unread[0] === "m1 → mac (from cloud): s" && a.stale.length === 0]);

  const failed = checks.filter(([, ok]) => !ok);
  for (const [name, ok] of checks) console.log(`  ${ok ? "ok" : "FAIL"} — self-test: ${name}`);
  console.log(`\nself-test ${failed.length === 0 ? "passed" : "FAILED"} (${checks.length - failed.length}/${checks.length})`);
  return failed.length === 0 ? 0 : 1;
}

if (process.argv.includes("--self-test")) process.exit(selfTest());

const messages = loadMessages();
const { problems, unread, stale } = auditLaneMessages(messages, loadAcks());

console.log(`Lane messages — ${messages.length} sent, ${messages.length - unread.length} acknowledged`);
if (unread.length > 0) {
  console.log("\n  UNREAD — sent, not yet acknowledged by the addressee:");
  for (const u of unread) console.log(`    · ${u}`);
  console.log("  The addressed lane reads them with:  pnpm run lane:inbox");
}
if (stale.length > 0) {
  console.log(`\n  STALE — unread beyond 24h: ${stale.length}. Reported, never fatal: the addressee's machine may be asleep;`);
  console.log("  if it is awake, the loop is broken — comment on the mailbox PR (docs/agent/lane-mailbox.json) to wake the cloud lane now.");
}
if (problems.length > 0) {
  console.error(`\nLane message check FAILED: ${problems.length} problem(s).`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log("\nLane message check passed — every ack belongs to a real message and to its addressee.");
