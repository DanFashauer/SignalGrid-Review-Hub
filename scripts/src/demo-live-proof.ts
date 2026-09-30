/**
 * `proof:demo-live` — the acceptance proof for `pnpm run demo:live`.
 *
 * The demo is only worth showing if every card on its page was COMPUTED: by the real
 * decision core, the real cascade joins and the real dispatch seam, on a stepping
 * clock. This proof runs the story twice headless, then once through the live server
 * on 127.0.0.1:0, and asserts that
 *
 *   · every hop (a)…(m) carries the concrete fields the core and the seams produced,
 *   · the ticket desk opens ONLY because of the per-call env (control 1: the same
 *     incident under an empty env is refused by tier, and nothing reaches the desk),
 *   · an unapproved remediation is never verified cleared (control 2),
 *   · two fresh runs are byte-identical and every instant sits on the stepping clock,
 *   · the page's SSE stream carries exactly the headless events, and a notice becomes
 *     delivered only when a host confirms it — once, and only on the device channel.
 *
 * `storyGaps` grades the story; --self-test removes each event and plants three
 * failures (not cleared, still restricted, ticket refused) and requires every one to
 * be NAMED. A bind failure is a FAIL, never a skip.
 *
 * Run: pnpm run proof:demo-live   (--self-test for the planted gaps alone)
 */

import { dispatchIncident } from "@workspace/incident-playbook";
import { restrictionHolds, verifyRemediation } from "@workspace/signalgrid-core";
import {
  createDemo,
  DESK_CONFIG,
  DEMO_PAGE_HTML,
  playStory,
  startDemoServer,
  STORY_START,
  STORY_STEPS,
  storyGaps,
  type DemoEvent,
} from "./demo-live";

const selfTestOnly = process.argv.includes("--self-test");

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean): void {
  if (ok) passed += 1;
  else failures.push(name);
  console.log(`  ${ok ? "ok" : "FAIL"} — ${name}`);
}

function finish(): never {
  const total = passed + failures.length;
  if (failures.length > 0) {
    console.error("Failed checks:");
    for (const f of failures) console.error(`  - ${f}`);
    console.log(`summary=fail (${passed}/${total})`);
    process.exit(1);
  }
  console.log(`summary=pass (${passed}/${total})`);
  process.exit(0);
}

type Detail = Record<string, unknown>;
const byStep = (events: readonly DemoEvent[], step: string): DemoEvent | undefined => events.find((e) => e.step === step);
const detailOf = (events: readonly DemoEvent[], step: string): Detail => byStep(events, step)?.detail ?? {};

// ─────────────────────────────────────────────────────────────────────────────
// SELF-TEST — the grader must name every missing or failed hop.
// ─────────────────────────────────────────────────────────────────────────────
async function selfTest(): Promise<void> {
  console.log("SELF-TEST — storyGaps names every hop taken out or failed");
  const demo = createDemo();
  await playStory(demo, { stepDelayMs: 0 });
  const events = demo.events;
  check("self-test: the healthy story has no gaps (the grader is not a no-man)", storyGaps(events).length === 0);
  for (const step of STORY_STEPS) {
    const gaps = storyGaps(events.filter((e) => e.step !== step));
    check(`self-test: removing ${step} is named (${gaps.join("; ") || "NOTHING"})`, gaps.length > 0);
  }
  const mutate = (step: string, patch: Detail): DemoEvent[] =>
    events.map((e) => (e.step === step ? { ...e, detail: { ...e.detail, ...patch } } : e));
  const PLANTED: ReadonlyArray<readonly [string, DemoEvent[], string]> = [
    ["verification unobserved", mutate("verified", { state: "unobserved", restrictionHolds: true }), "verification not cleared"],
    ["final decision still restrict", mutate("decision.allow", { outcome: "restrict" }), "access not restored"],
    ["ticket refused", mutate("ticket", { opened: false }), "ticket not opened"],
  ];
  for (const [label, broken, expected] of PLANTED) {
    check(`self-test: ${label} is named "${expected}"`, storyGaps(broken).includes(expected));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HEADLESS — every hop, its fields, both controls, determinism.
// ─────────────────────────────────────────────────────────────────────────────
async function headless(): Promise<DemoEvent[]> {
  console.log("HEADLESS — the story on the real core, paced at 0 ms");
  const demo = createDemo();
  await playStory(demo, { stepDelayMs: 0 });
  const ev = demo.events;

  check("every story step emitted exactly once, in order",
    JSON.stringify(ev.map((e) => e.step)) === JSON.stringify(STORY_STEPS));
  check("seq runs 1..N with no gap", ev.every((e, i) => e.seq === i + 1));
  check("every event names the system that acted", ev.every((e) => typeof e.system === "string" && e.system.length > 0));

  const a = detailOf(ev, "baseline");
  check("(a) baseline: Jordan on Ward iPad 02 is allowed", a.outcome === "allow");

  const b = detailOf(ev, "signal.noncompliant");
  check("(b) the non-compliant MDM report is applied (success, 1 record, signals normalized)",
    b.status === "success" && b.recordsProcessed === 1 && typeof b.signalsNormalized === "number" && b.signalsNormalized > 0);

  const c = detailOf(ev, "decision.restrict");
  const decisionId = String(c.decisionId ?? "");
  check("(c) the core decides restrict", c.outcome === "restrict");
  check("(c) …because DEVICE_NONCOMPLIANT", Array.isArray(c.reasonCodes) && c.reasonCodes.includes("DEVICE_NONCOMPLIANT"));
  check("(c) the decision has an id", decisionId.length > 0);

  const d = detailOf(ev, "plan");
  const steps = (Array.isArray(d.steps) ? d.steps : []) as Detail[];
  check("(d) the plan has steps", steps.length > 0);
  check("(d) a step answers DEVICE_NONCOMPLIANT with a class, a channel and an action",
    steps.some((s) => s.reasonCode === "DEVICE_NONCOMPLIANT" && typeof s.resolutionClass === "string" &&
      typeof s.channel === "string" && typeof s.action === "string" && String(s.action).length > 0));

  const e = detailOf(ev, "incident");
  check("(e) the incident is correlated to the decision", e.correlationId === decisionId);
  check("(e) impact high × urgency high is P1", e.priority === "P1");

  const f = detailOf(ev, "ticket");
  check("(f) the ticket opened through the dispatch seam", f.opened === true);
  check("(f) the ticket id is the desk's deterministic one", f.ticketId === `DEMO-${decisionId.slice(-6)}`);
  check("(f) the queue item is delivered with that receipt", f.queueStatus === "delivered" && f.receiptRef === f.ticketId);
  check("(f) exactly one ticket reached the local desk", demo.desk.tickets.length === 1);
  check("(f) the desk received the seam's P1 request", demo.desk.tickets[0]?.title.startsWith("[P1] ") === true);

  const g = detailOf(ev, "change");
  check("(g) the change draft was submitted to the desk", g.status === "submitted" && demo.desk.changes.length === 1);
  check("(g) the draft is still approval-required and simulated", g.approvalRequired === true && g.simulatedOnly === true);
  check("(g) its queue item is delivered", g.queueStatus === "delivered");

  const h = detailOf(ev, "notice.routed");
  const notices = (Array.isArray(h.notices) ? h.notices : []) as Detail[];
  const device = notices.filter((n) => n.channel === "device_prompt");
  check("(h) somebody was routed", notices.length > 0);
  check("(h) exactly one notice goes to a device_prompt", device.length === 1);
  check("(h) the decision's own subject (Jordan) is NOT notified — the library's exclusion holds",
    !notices.some((n) => n.principalRef === h.subjectRef) && h.subjectRef === "user-jordan");
  check("(h) the charge nurse is routed on the operator console",
    notices.some((n) => n.channel === "operator_console"));
  check("(h) every notice starts undelivered",
    notices.every((n) => (n.delivery as Detail | undefined)?.state === "undelivered"));

  const i = detailOf(ev, "remediation.approved");
  check("(i) the device remediation was approved (simulated)",
    i.status === "approved_simulated" && i.kind === "request_device_remediation");
  check("(i) the label says simulated and that SignalGrid executed no change",
    typeof i.label === "string" && i.label.includes("simulated") && i.label.includes("executed no change"));

  const j = detailOf(ev, "signal.compliant");
  check("(j) the MDM's compliant report is applied", j.status === "success" && j.recordsProcessed === 1);

  const k = detailOf(ev, "decision.allow");
  check("(k) the core decides allow again", k.outcome === "allow");
  check("(k) and DEVICE_NONCOMPLIANT is gone", Array.isArray(k.reasonCodes) && !k.reasonCodes.includes("DEVICE_NONCOMPLIANT"));

  const l = detailOf(ev, "verified");
  check("(l) the verifier reads cleared", l.state === "cleared");
  check("(l) the restriction no longer holds", l.restrictionHolds === false);

  const m = detailOf(ev, "cascade.complete");
  const summary = (m.summary ?? {}) as Detail;
  check("(m) the audit chain verifies", m.auditValid === true);
  check("(m) the queue holds ticket + change + one per notice", summary.total === 2 + notices.length);
  check("(m) nothing is rounded up: undelivered notices keep allDelivered false",
    summary.delivered === 2 && summary.allDelivered === false);

  // CONTROL 1 — the per-call env is what opens the desk.
  const incident = demo.incident;
  const before = demo.desk.tickets.length;
  const shut = incident
    ? await dispatchIncident(incident, "generic_webhook", DESK_CONFIG, {}, () => demo.desk.adapter)
    : null;
  check("control 1: the same incident under an empty env is NOT opened", shut !== null && shut.opened === false);
  check("control 1: …and the refusal names tier \"dev\"", shut !== null && !shut.opened && shut.reason.includes('tier "dev"'));
  check("control 1: nothing reached the desk", demo.desk.tickets.length === before);

  // CONTROL 2 — an unapproved remediation is never verified cleared.
  const requested = demo.requested;
  const unapproved = requested
    ? verifyRemediation(requested, [{ targetRef: requested.targetRef, reasonCodes: (k.reasonCodes as string[]) ?? [], observedAt: byStep(ev, "decision.allow")?.at ?? "" }], demo.clock.now().toISOString())
    : null;
  check("control 2: the unapproved remediation is still requires_approval", requested?.status === "requires_approval");
  check("control 2: verifying it reads unobserved", unapproved?.state === "unobserved");
  check("control 2: and the restriction holds", unapproved !== null && restrictionHolds(unapproved) === true);

  // Determinism and the clock.
  const again = createDemo();
  await playStory(again, { stepDelayMs: 0 });
  check("determinism: a second fresh run is JSON-equal", JSON.stringify(again.events) === JSON.stringify(ev));
  const end = demo.clock.now().toISOString();
  check(`every event's instant lies on the stepping clock [${STORY_START} … ${end}]`,
    ev.every((x) => x.at >= STORY_START && x.at <= end) && end > STORY_START);
  check("storyGaps(events) is empty", storyGaps(ev).length === 0);

  const copy = DEMO_PAGE_HTML + JSON.stringify(ev);
  check("no copy cites DR-062 or makes a world's-first claim", !copy.includes("DR-062") && !/world.s first/i.test(copy));
  return ev;
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVER — the page, the stream, the host acknowledgement, a clean close.
// ─────────────────────────────────────────────────────────────────────────────
async function readUntilComplete(url: string, ms: number): Promise<DemoEvent[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const out: DemoEvent[] = [];
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    check("GET /events is text/event-stream", (res.headers.get("content-type") ?? "").startsWith("text/event-stream"));
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (!out.some((e) => e.step === "cascade.complete")) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let cut = buf.indexOf("\n\n");
      while (cut >= 0) {
        const frame = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        for (const line of frame.split("\n")) if (line.startsWith("data: ")) out.push(JSON.parse(line.slice(6)) as DemoEvent);
        cut = buf.indexOf("\n\n");
      }
    }
    await reader.cancel().catch(() => undefined);
  } catch (err) {
    check(`the SSE stream reached cascade.complete within ${ms} ms (${err instanceof Error ? err.message : String(err)})`, false);
  } finally {
    clearTimeout(timer);
  }
  return out;
}

async function served(headlessEvents: DemoEvent[]): Promise<void> {
  console.log("SERVER — 127.0.0.1:0, the page, the stream, the host acknowledgement");
  const demo = createDemo();
  let server: Awaited<ReturnType<typeof startDemoServer>>;
  try {
    server = await startDemoServer(demo, { host: "127.0.0.1", port: 0, stepDelayMs: 0 });
  } catch (err) {
    check(`the demo server binds 127.0.0.1:0 (${err instanceof Error ? err.message : String(err)})`, false);
    return;
  }
  check("the demo server bound an OS-assigned port", server.port > 0);
  const base = `http://127.0.0.1:${server.port}`;

  const page = await fetch(`${base}/`);
  const html = await page.text();
  check("GET / is 200 text/html; charset=utf-8",
    page.status === 200 && page.headers.get("content-type") === "text/html; charset=utf-8");
  check("the page subscribes to /events", html.includes("/events"));
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
  let compiles = false;
  try {
    new Function(script);
    compiles = script.length > 0;
  } catch {
    compiles = false;
  }
  check("the page's <script> compiles (syntax only, not executed)", compiles);
  check("the story has not started before the first /events viewer", demo.events.length === 0);

  const streamed = await readUntilComplete(`${base}/events`, 20_000);
  check("the streamed events deep-equal the headless run", JSON.stringify(streamed) === JSON.stringify(headlessEvents));

  const notices = (detailOf(demo.events, "notice.routed").notices ?? []) as Detail[];
  const deviceId = String(notices.find((n) => n.channel === "device_prompt")?.id ?? "");
  const consoleId = String(notices.find((n) => n.channel === "operator_console")?.id ?? "");
  const ack = (id: string): Promise<Response> => fetch(`${base}/ack/${encodeURIComponent(id)}`, { method: "POST" });

  const first = await ack(deviceId);
  await first.text();
  check("POST /ack/<device notice> is 200", first.status === 200);
  const delivered = byStep(demo.events, "notice.delivered");
  const end = demo.clock.now().toISOString();
  check("…and a notice.delivered event names byHost host:demo-page",
    delivered?.detail.byHost === "host:demo-page" && delivered.detail.noticeId === deviceId);
  check("…at a stepping-clock instant (the server's clock, never the phone's)",
    typeof delivered?.detail.at === "string" && delivered.detail.at >= STORY_START && delivered.detail.at <= end && delivered.at === delivered.detail.at);
  const repeat = await ack(deviceId);
  await repeat.text();
  check("a repeat ack is 409", repeat.status === 409);
  const onConsole = await ack(consoleId);
  await onConsole.text();
  check("an operator_console notice cannot be acked by the device host (409)", consoleId.length > 0 && onConsole.status === 409);
  const nope = await ack("nope");
  await nope.text();
  check("an unknown notice is 404", nope.status === 404);
  const missing = await fetch(`${base}/nope`);
  await missing.text();
  check("GET /nope is 404", missing.status === 404);

  // close() with a viewer still attached.
  const held = await fetch(`${base}/events`);
  const heldReader = held.body!.getReader();
  await heldReader.read();
  const closed = await Promise.race([
    server.close().then(() => true),
    new Promise<boolean>((r) => setTimeout(() => r(false), 5_000).unref()),
  ]);
  check("close() resolves while an SSE client is still attached", closed);
  void heldReader.cancel().catch(() => undefined);
  let refused = false;
  try {
    await fetch(`${base}/`);
  } catch {
    refused = true;
  }
  check("after close() the server answers nothing", refused);
}

if (selfTestOnly) {
  await selfTest();
} else {
  const headlessEvents = await headless();
  await served(headlessEvents);
  await selfTest();
}
finish();
