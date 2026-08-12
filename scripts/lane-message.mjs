// lane-message.mjs — the lanes talk to each other through git, not through a human.
//
//   pnpm run lane:inbox                          # messages addressed to me, unread
//   pnpm run lane:inbox --all                    # including ones I have acknowledged
//   pnpm run lane:send "subject" "body…"         # write one to the other lane
//   pnpm run lane:ack <id> ["what I did"]        # acknowledge, optionally with an answer
//
// WHY THIS EXISTS. The simulation request loop already carries WORK between the
// cloud lane and the Mac lane. It does not carry what one lane needs the other to
// KNOW — "your branch moved", "that PR already exists", "this gate flaked once and
// here is what I could not determine". That half was being couriered by the owner,
// retyped between two chat windows, which is a bus with one very expensive hop and
// a person who is phone-first and at the remote office a few hours a day.
//
// Direct session-to-session messaging exists and is NOT a substitute: it has
// proved one-way in practice (cloud→Mac returns HTTP 401), it is invisible to the
// owner, and it leaves no artifact — so a claim about what the other lane was told
// is unverifiable afterwards. Git is the bus both lanes provably read, the owner
// can see every word without being asked to carry any of it, and the history says
// who knew what and when.
//
// THE LAW THIS SHARES WITH THE REQUEST LOOP: an unacknowledged message is PENDING
// and REPORTED — never assumed read. `check-lane-messages.mjs` names every one on
// every run. Pending never fails the build: the other lane's machine is not always
// awake, and blocking CI on somebody else reading their mail would be the same
// dishonesty running the other way.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { currentLane, otherLane, LANES } from "./lib/lane-identity.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MSG_DIR = join(repo, "artifacts/lane-messages");
export const ACK_DIR = join(MSG_DIR, "acks");

const listJson = (dir) =>
  existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

export function loadMessages() {
  return listJson(MSG_DIR).map((f) => ({ ...readJson(join(MSG_DIR, f)), __fileId: f.replace(/\.json$/, "") }));
}
export function loadAcks() {
  return listJson(ACK_DIR).map((f) => ({ ...readJson(join(ACK_DIR, f)), __fileId: f.replace(/\.json$/, "") }));
}

/** Pure, so the gate and its self-test drive the same code path. */
export function auditLaneMessages(messages, acks) {
  const problems = [];
  const unread = [];
  const byId = new Map(messages.map((m) => [m.id, m]));

  for (const m of messages) {
    if (m.id !== m.__fileId) problems.push(`message ${m.__fileId}: id "${m.id}" does not match its filename`);
    if (!LANES.includes(m.from)) problems.push(`message ${m.__fileId}: from "${m.from}" is not a known lane (${LANES.join(", ")})`);
    if (!LANES.includes(m.to)) problems.push(`message ${m.__fileId}: to "${m.to}" is not a known lane (${LANES.join(", ")})`);
    if (m.from === m.to) problems.push(`message ${m.__fileId}: addressed to its own sender`);
    if (!m.subject || String(m.subject).trim() === "") problems.push(`message ${m.__fileId}: no subject`);
    if (!m.body || String(m.body).trim() === "") problems.push(`message ${m.__fileId}: no body — an empty message is worse than none, it looks answered`);
  }

  const ackedIds = new Set();
  for (const a of acks) {
    const m = byId.get(a.messageId);
    if (!m) {
      problems.push(`ack ${a.__fileId}: acknowledges "${a.messageId}", which does not exist`);
      continue;
    }
    // An ack from the SENDER would let a lane mark its own message read — the
    // acknowledgement equivalent of grading your own homework.
    if (a.ackedBy !== m.to) {
      problems.push(`ack ${a.__fileId}: acknowledged by "${a.ackedBy}" but the message was addressed to "${m.to}"`);
      continue;
    }
    ackedIds.add(a.messageId);
  }

  for (const m of messages) {
    if (!ackedIds.has(m.id)) unread.push(`${m.id} → ${m.to} (from ${m.from}): ${m.subject}`);
  }
  return { problems, unread, ackedIds };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
// Guarded on being the entry point: the gate and the proof IMPORT this module for
// `auditLaneMessages`, and a module that prints an inbox as a side effect of being
// imported makes every consumer's output untrustworthy.
function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

function runCli() {
const [cmd, ...rest] = process.argv.slice(2);
const me = currentLane();

if (cmd === "send") {
  // The id carries the sender and the subject, never a clock: two lanes writing
  // on the same day must not collide, and a wall-clock filename would make the
  // directory unreproducible. `--id` overrides when a caller wants a stable name.
  // It is REMOVED from argv before the body is assembled — leaving it in would
  // silently append "--id whatever" to the message text.
  const idFlag = rest.indexOf("--id");
  const explicitId = idFlag >= 0 ? rest[idFlag + 1] : undefined;
  if (idFlag >= 0 && !explicitId) {
    console.error("--id needs a value");
    process.exit(2);
  }
  const words = idFlag >= 0 ? [...rest.slice(0, idFlag), ...rest.slice(idFlag + 2)] : rest;
  const [subject, ...bodyParts] = words;
  const body = bodyParts.join(" ");
  if (!subject || !body) {
    console.error('usage: pnpm run lane:send "subject" "body…"');
    process.exit(2);
  }
  // Slugged unconditionally, including an explicit --id: this value becomes a
  // FILENAME, and the sending lane is not always the lane that authored the
  // string. `../../something` must become `something`, not an escape.
  const id = slug(explicitId ?? `${me}-${subject}`);
  if (!id) {
    console.error("that id reduces to nothing after slugging — give it some letters or digits");
    process.exit(2);
  }
  mkdirSync(MSG_DIR, { recursive: true });
  const path = join(MSG_DIR, `${id}.json`);
  writeFileSync(path, `${JSON.stringify({ schemaVersion: 1, id, from: me, to: otherLane(me), subject, body }, null, 2)}\n`, "utf8");
  console.log(`wrote ${path}`);
  console.log("Commit and push it — that is the delivery:");
  console.log("  git add artifacts/lane-messages && git commit -m 'lane message' && git push");
} else if (cmd === "ack") {
  const [messageId, ...noteParts] = rest;
  if (!messageId) {
    console.error("usage: pnpm run lane:ack <message-id> [\"what I did about it\"]");
    process.exit(2);
  }
  const messages = loadMessages();
  const m = messages.find((x) => x.id === messageId);
  if (!m) {
    console.error(`no message with id "${messageId}". Run: pnpm run lane:inbox`);
    process.exit(2);
  }
  if (m.to !== me) {
    console.error(`"${messageId}" is addressed to the ${m.to} lane; this machine is the ${me} lane. Refusing to acknowledge somebody else's mail.`);
    process.exit(2);
  }
  mkdirSync(ACK_DIR, { recursive: true });
  const note = noteParts.join(" ");
  // Slugged for the same reason `send` slugs: the id names a file, and the file
  // it names must land inside the ack directory.
  writeFileSync(
    join(ACK_DIR, `${slug(messageId)}.json`),
    `${JSON.stringify({ schemaVersion: 1, messageId, ackedBy: me, note: note || null }, null, 2)}\n`,
    "utf8",
  );
  console.log(`acknowledged ${messageId}. Commit and push so the other lane can see it.`);
} else if (cmd === "inbox" || cmd === undefined) {
  const all = rest.includes("--all");
  const messages = loadMessages();
  const { ackedIds } = auditLaneMessages(messages, loadAcks());
  const mine = messages.filter((m) => m.to === me && (all || !ackedIds.has(m.id)));
  console.log(`Lane inbox — this machine is the ${me.toUpperCase()} lane (override with SIGNALGRID_LANE)\n`);
  if (mine.length === 0) {
    console.log(all ? "  nothing addressed to this lane." : "  nothing unread. (--all to include acknowledged.)");
  }
  for (const m of mine) {
    console.log(`── ${m.id}${ackedIds.has(m.id) ? "  [acknowledged]" : ""}`);
    console.log(`   from ${m.from}: ${m.subject}\n`);
    for (const line of String(m.body).split("\n")) console.log(`   ${line}`);
    console.log(`\n   acknowledge with: pnpm run lane:ack ${m.id} "what you did"\n`);
  }
} else {
  console.error(`unknown command "${cmd}". Try: inbox | send | ack`);
  process.exit(2);
}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
