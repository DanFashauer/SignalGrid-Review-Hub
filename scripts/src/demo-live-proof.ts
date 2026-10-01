/**
 * `proof:demo-live` — the acceptance proof for `pnpm run demo:live`.
 *
 * The demo is only worth showing if every decision, id and status on its page was
 * COMPUTED: by the real decision core, the real cascade joins and the real dispatch
 * seam, on a stepping clock. This proof runs the story headless, then through the
 * live server on 127.0.0.1:0, then runs the page's own script in node:vm, and asserts
 *
 *   · every hop (a)…(m) carries the concrete fields the core and the seams produced,
 *     and the story ends with ONE whole-story verdict from `storyGaps`,
 *   · the verdict fails when a hop fails: a refused ticket ends story.failed even
 *     though the verifier still reads cleared; an allow at (c) cascades nothing,
 *   · the ticket desk opens ONLY because of the per-call env (control 1: the same
 *     incident under an empty env is refused by tier, and nothing reaches the desk),
 *   · an unapproved remediation is never verified cleared (control 2),
 *   · two fresh runs are byte-identical and every instant sits on the stepping clock,
 *   · the page's SSE stream carries exactly the headless events, a notice becomes
 *     delivered only when a host confirms it (once, and only on the device channel),
 *     and POST /replay plays an identical story to a viewer already watching,
 *   · the page script, run against a fake DOM, shows the passed and the failed banner,
 *     Jordan's worker summary, and a second screen's 409 as "confirmed on another screen".
 *
 * `storyGaps` grades the story; --self-test removes each event and plants four
 * failures and requires every one to be NAMED. A bind failure is a FAIL, never a skip.
 *
 * Run: pnpm run proof:demo-live   (--self-test for the planted gaps alone)
 */

import { createContext, runInContext } from "node:vm";
import { dispatchIncident } from "@workspace/incident-playbook";
import { restrictionHolds, verifyRemediation } from "@workspace/signalgrid-core";
import {
  createDemo,
  DESK_CONFIG,
  DEMO_PAGE_HTML,
  playStory,
  startDemoServer,
  STORY_END,
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
const isEnd = (step: unknown): boolean => (STORY_END as readonly unknown[]).includes(step);

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
    ["Jordan's screen blank", mutate("plan", { summaryForWorker: "" }), "no worker screen"],
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

  check("every story step emitted exactly once, in order, then story.passed",
    JSON.stringify(ev.map((e) => e.step)) === JSON.stringify([...STORY_STEPS, "story.passed"]));
  check("seq runs 1..N with no gap", ev.every((e, i) => e.seq === i + 1));
  check("every event names the system that acted", ev.every((e) => typeof e.system === "string" && e.system.length > 0));
  check("every event leads with a plain-English sentence", ev.every((e) => typeof e.plain === "string" && e.plain.length > 0));

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
  check("(d) the plan carries the engine's worker summary for Jordan's screen",
    typeof d.summaryForWorker === "string" && d.summaryForWorker.length > 0);

  const e = detailOf(ev, "incident");
  check("(e) the incident is correlated to the decision", e.correlationId === decisionId);
  check("(e) impact high × urgency high is P1", e.priority === "P1");
  check("(e) the incident says its trigger is scenario input, scripted by this demo",
    e.trigger === "scenario input, scripted by this demo" && byStep(ev, "incident")?.plain.includes("scripted by this demo") === true);

  const f = detailOf(ev, "ticket");
  check("(f) the ticket opened through the dispatch seam", f.opened === true);
  check("(f) the ticket id is the desk's deterministic one", f.ticketId === `DEMO-${decisionId.slice(-6)}`);
  check("(f) the queue item is delivered with that receipt", f.queueStatus === "delivered" && f.receiptRef === f.ticketId);
  check("(f) exactly one ticket reached the local desk", demo.desk.tickets.length === 1);
  check("(f) the desk received the seam's P1 request", demo.desk.tickets[0]?.title.startsWith("[P1] ") === true);
  check("(f) the ticket card says a demo-only setting opens the emission gate",
    String(f.emissionGate).includes("demo-only") && byStep(ev, "ticket")?.plain.includes("demo-only setting") === true);

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
  const notDelivered = (Array.isArray(m.notDelivered) ? m.notDelivered : []) as string[];
  check("(m) the audit chain verifies", m.auditValid === true);
  check("(m) the queue holds ticket + change + one per notice", summary.total === 2 + notices.length);
  check("(m) nothing is rounded up: undelivered notices keep allDelivered false",
    summary.delivered === 2 && summary.allDelivered === false);
  check("(m) every undelivered item has a plain reason, and the console notice says it has no transport here",
    notDelivered.length === Number(summary.total) - Number(summary.delivered) &&
      notDelivered.some((r) => r.includes("the console notice has no transport in this demo")));

  check("the verdict is story.passed, and storyGaps(events) is empty",
    ev.at(-1)?.step === "story.passed" && storyGaps(ev).length === 0);

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

  const copy = DEMO_PAGE_HTML + JSON.stringify(ev);
  check("no copy cites DR-062 or makes a world's-first claim", !copy.includes("DR-062") && !/world.s first/i.test(copy));
  check("the page no longer claims nothing on it is pre-written", !/pre-written/i.test(DEMO_PAGE_HTML));
  return ev;
}

// ─────────────────────────────────────────────────────────────────────────────
// FAILURE PATHS — the whole-story verdict must go red when a hop fails.
// ─────────────────────────────────────────────────────────────────────────────
async function failurePaths(): Promise<DemoEvent[]> {
  console.log("FAILURE PATHS — a refused ticket, and a signal that never lands");
  const down = createDemo();
  down.desk.adapter.createTicket = async () => {
    throw new Error("desk offline (planted by proof:demo-live)");
  };
  await playStory(down, { stepDelayMs: 0 });
  const last = down.events.at(-1);
  check("desk down: the story ends story.failed, never story.passed",
    last?.step === "story.failed" && !down.events.some((e) => e.step === "story.passed"));
  check("desk down: the verdict names the gap (\"Story did not complete: ticket not opened\")",
    last?.title === "Story did not complete: ticket not opened");
  check("desk down: …although the verifier still reads cleared (the verdict is the whole story, not one hop)",
    detailOf(down.events, "verified").state === "cleared");

  const quiet = createDemo();
  const real = quiet.core.refreshEstatePosture.bind(quiet.core);
  quiet.core.refreshEstatePosture = (records) => real(records.map((r) => ({ ...r, compliance: "compliant" })));
  let threw = false;
  try {
    await playStory(quiet, { stepDelayMs: 0 });
  } catch {
    threw = true;
  }
  const stop = quiet.events.at(-1);
  check("allow at (c): the story throws instead of cascading", threw);
  check("allow at (c): it ends story.failed naming \"not restrict\"",
    stop?.step === "story.failed" && stop.title.includes("was allow, not restrict"));
  check("allow at (c): no plan, no incident, nothing reached the desk",
    !quiet.events.some((e) => e.step === "plan" || e.step === "incident") && quiet.desk.tickets.length === 0 && quiet.desk.changes.length === 0);
  return down.events;
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVER — the page, the stream, the host acknowledgement, replay, a clean close.
// ─────────────────────────────────────────────────────────────────────────────
type Frame = Record<string, unknown>;

/** Reads SSE `data:` frames until `stop` says so, the stream ends, or `ms` passes. */
async function readFrames(label: string, url: string, ms: number, stop: (frame: Frame, all: Frame[]) => boolean): Promise<Frame[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const out: Frame[] = [];
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    check(`${label}: GET /events is text/event-stream`, (res.headers.get("content-type") ?? "").startsWith("text/event-stream"));
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let done = false;
    while (!done) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buf += decoder.decode(chunk.value, { stream: true });
      let cut = buf.indexOf("\n\n");
      while (cut >= 0) {
        const block = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        for (const line of block.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const frame = JSON.parse(line.slice(6)) as Frame;
          out.push(frame);
          if (stop(frame, out)) done = true;
        }
        cut = buf.indexOf("\n\n");
      }
    }
    await reader.cancel().catch(() => undefined);
  } catch (err) {
    check(`${label}: the stream finished within ${ms} ms (${err instanceof Error ? err.message : String(err)})`, false);
  } finally {
    clearTimeout(timer);
  }
  return out;
}

/** Splits frames at each `{reset}` into one event list per run. */
const runs = (frames: readonly Frame[]): { run: unknown; events: DemoEvent[] }[] => {
  const out: { run: unknown; events: DemoEvent[] }[] = [];
  for (const f of frames) {
    if (f.reset === true) out.push({ run: f.run, events: [] });
    else out[out.length - 1]?.events.push(f as unknown as DemoEvent);
  }
  return out;
};

async function served(headlessEvents: DemoEvent[], failedEvents: DemoEvent[]): Promise<void> {
  console.log("SERVER — 127.0.0.1:0, the page, the stream, the host acknowledgement, replay");
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
  const post = async (path: string): Promise<{ status: number; body: Frame }> => {
    const res = await fetch(`${base}${path}`, { method: "POST" });
    return { status: res.status, body: (await res.json()) as Frame };
  };

  const page = await fetch(`${base}/`);
  const html = await page.text();
  check("GET / is 200 text/html; charset=utf-8",
    page.status === 200 && page.headers.get("content-type") === "text/html; charset=utf-8");
  check("the page subscribes to /events", html.includes("/events"));

  const early = await post("/replay");
  check("POST /replay before any story has finished is 409", early.status === 409);
  check("the story has not started before the first /events viewer (a refused replay starts nothing)", demo.events.length === 0);

  const first = runs(await readFrames("first viewer", `${base}/events`, 20_000, (f) => isEnd(f.step)));
  check("a viewer's stream opens with {reset, run 1}", first.length === 1 && first[0]!.run === 1);
  check("the streamed events deep-equal the headless run", JSON.stringify(first[0]?.events) === JSON.stringify(headlessEvents));

  const notices = (detailOf(demo.events, "notice.routed").notices ?? []) as Detail[];
  const deviceId = String(notices.find((n) => n.channel === "device_prompt")?.id ?? "");
  const consoleId = String(notices.find((n) => n.channel === "operator_console")?.id ?? "");
  const ack = (id: string): Promise<{ status: number; body: Frame }> => post(`/ack/${encodeURIComponent(id)}`);

  const acked = await ack(deviceId);
  check("POST /ack/<device notice> is 200", acked.status === 200);
  const delivered = byStep(demo.events, "notice.delivered");
  const end = demo.clock.now().toISOString();
  check("…and a notice.delivered event names byHost host:demo-page",
    delivered?.detail.byHost === "host:demo-page" && delivered.detail.noticeId === deviceId);
  check("…at a stepping-clock instant (the server's clock, never the phone's)",
    typeof delivered?.detail.at === "string" && delivered.detail.at >= STORY_START && delivered.detail.at <= end && delivered.at === delivered.detail.at);
  const repeat = await ack(deviceId);
  check("a second screen's ack is 409 with the exact error \"already delivered\" (the page keys on it)",
    repeat.status === 409 && repeat.body.error === "already delivered");
  const onConsole = await ack(consoleId);
  check("an operator_console notice cannot be acked by the device host (409)", consoleId.length > 0 && onConsole.status === 409);
  const nope = await ack("nope");
  check("an unknown notice is 404", nope.status === 404);
  const missing = await fetch(`${base}/nope`);
  await missing.text();
  check("GET /nope is 404", missing.status === 404);

  // REPLAY — a viewer already watching is reset, then sees the fresh story.
  const replayed: { reply?: Promise<{ status: number; body: Frame }> } = {};
  const watching = runs(await readFrames("watching viewer", `${base}/events`, 20_000, (f, all) => {
    const ends = all.filter((x) => isEnd(x.step)).length;
    if (ends === 1 && isEnd(f.step)) replayed.reply = post("/replay");
    return ends >= 2;
  }));
  const reply = replayed.reply ? await replayed.reply : null;
  check("POST /replay after the story finished is 200, run 2", reply?.status === 200 && reply.body.run === 2);
  check("the watching viewer got run 1 (with its ack) and then a reset to run 2",
    watching.length === 2 && watching[0]!.run === 1 && watching[1]!.run === 2 &&
      JSON.stringify(watching[0]!.events) === JSON.stringify(demo.events));
  check("the replay is event for event the headless story (fresh deterministic core)",
    JSON.stringify(watching[1]?.events) === JSON.stringify(headlessEvents));
  const replayAck = await ack(deviceId);
  check("the replay's device notice is undelivered again (its ack is 200)", replayAck.status === 200);

  // THE PAGE SCRIPT, run against a fake DOM.
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
  await pageRuns(script, headlessEvents, failedEvents);

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

// ─────────────────────────────────────────────────────────────────────────────
// PAGE — the served <script> in node:vm, against the few DOM calls it makes.
// ─────────────────────────────────────────────────────────────────────────────
class FakeEl {
  className = "";
  hidden = false;
  disabled = false;
  onclick: (() => void) | null = null;
  children: FakeEl[] = [];
  private own = "";
  constructor(readonly tag: string) {}
  appendChild(child: FakeEl): FakeEl {
    this.children.push(child);
    return child;
  }
  get textContent(): string {
    return this.own + this.children.map((c) => c.textContent).join("");
  }
  set textContent(value: string) {
    this.own = String(value);
    this.children = [];
  }
  all(): FakeEl[] {
    return [this, ...this.children.flatMap((c) => c.all())];
  }
}

async function pageRuns(script: string, passedEvents: DemoEvent[], failedEvents: DemoEvent[]): Promise<void> {
  console.log("PAGE — the served script in node:vm with a fake DOM, EventSource and fetch");
  const ids = new Map<string, FakeEl>();
  const byId = (id: string): FakeEl => ids.get(id) ?? ids.set(id, new FakeEl(id)).get(id)!;
  const calls: string[] = [];
  let ackReply = { ok: false, status: 409, body: { error: "already delivered" } as Frame };
  const fetchFake = (url: string, init?: { method?: string }): Promise<unknown> => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const r = url.startsWith("/ack/") ? ackReply : { ok: true, status: 200, body: { run: 2 } as Frame };
    return Promise.resolve({ ok: r.ok, status: r.status, json: () => Promise.resolve(r.body) });
  };
  let source: { url: string; onmessage?: (m: { data: string }) => void } | null = null;
  class FakeEventSource {
    onmessage?: (m: { data: string }) => void;
    constructor(readonly url: string) {
      source = this;
    }
  }
  const settle = (): Promise<void> => new Promise((r) => setImmediate(r));
  try {
    runInContext(script, createContext({
      document: { getElementById: byId, createElement: (tag: string) => new FakeEl(tag) },
      EventSource: FakeEventSource,
      fetch: fetchFake,
    }));
  } catch (err) {
    check(`page: the script runs (${err instanceof Error ? err.message : String(err)})`, false);
    return;
  }
  const es = source as { url: string; onmessage?: (m: { data: string }) => void } | null;
  check("page: the script opens an EventSource on /events", es?.url === "/events" && typeof es.onmessage === "function");
  const send = (body: unknown): void => es?.onmessage?.({ data: JSON.stringify(body) });
  const banner = byId("banner");
  const replay = byId("replay");
  const nodes = (): FakeEl[] => byId("timeline").all();

  send({ reset: true, run: 1 });
  for (const e of passedEvents) send(e);
  await settle();
  check("page: story.passed turns the banner on, green, with the verdict's words",
    banner.className === "on" && banner.textContent.startsWith("Access restored"));
  const summary = String(detailOf(passedEvents, "plan").summaryForWorker ?? "");
  check("page: Jordan's app card shows the engine's worker summary",
    nodes().some((n) => n.textContent === "What Jordan's app shows") && summary.length > 0 &&
      nodes().some((n) => n.className === "hosttext" && n.textContent === summary));
  check("page: the host card posts its ack", calls.some((c) => c.startsWith("POST /ack/")));
  check("page: a 409 \"already delivered\" reads \"confirmed on another screen\", styled as success",
    nodes().some((n) => n.textContent === "confirmed on another screen" && n.className === "meta ok") &&
      !nodes().some((n) => n.textContent.startsWith("not confirmed")));
  check("page: raw key=value details sit inside <details>", nodes().some((n) => n.tag === "details" && n.children.some((c) => c.tag === "dl")));
  check("page: the Replay button shows once the story has a verdict", replay.hidden === false);
  replay.onclick?.();
  await settle();
  check("page: Replay POSTs /replay", calls.includes("POST /replay"));

  send({ reset: true, run: 2 });
  check("page: a reset clears the timeline and the banner and hides Replay",
    byId("timeline").children.length === 0 && banner.className === "" && replay.hidden === true);
  ackReply = { ok: true, status: 200, body: {} };
  for (const e of failedEvents) send(e);
  await settle();
  check("page: story.failed turns the banner red and names the gap",
    banner.className === "on fail" && banner.textContent === "Story did not complete: ticket not opened");
  check("page: a 200 ack reads \"delivery confirmed by this screen\"",
    nodes().some((n) => n.textContent === "delivery confirmed by this screen" && n.className === "meta ok"));
}

if (selfTestOnly) {
  await selfTest();
} else {
  const headlessEvents = await headless();
  const failedEvents = await failurePaths();
  await served(headlessEvents, failedEvents);
  await selfTest();
}
finish();
