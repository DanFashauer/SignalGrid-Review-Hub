// Proof: a customer estate can boot a decision core, and it fails closed.
//
// The launch profile's `non-demo-core-constructor` gap said the served API had
// exactly one way to build a core — `SignalGridCore.demo()`, a seeded fixture
// world on a fixed clock — so a deployment demonstrated IN a customer
// environment without deciding ABOUT the customer's estate. This proves the
// second constructor, `SignalGridCore.fromEstate`, end to end over the committed
// Graph fixture dataset: read posture through the read-only connector, map it to
// estate subjects, build the core, decide.
//
// Claims:
//   1. Subjects come from the posture read. A device the source reported with no
//      resolvable owner is skipped and COUNTED; a subject the source never
//      reported is `not_found` to `evaluate`, never guessed.
//   2. Graph reads no encryption or OS-support fact, so the core holds none, and
//      `allow` never fires for any estate subject: every verdict is step_up,
//      restrict or deny. A disabled identity and an unknown-compliance device
//      are never allowed; a disabled identity is denied or restricted outright.
//   3. Not a demo core: `demoApiKeys()` refuses (403), `isDemo()` is false, and
//      a demo-shaped or short principal token is refused at build time.
//   4. `signalSource()` answers from the connector the core HOLDS: "live" when the
//      connector mode is live, "fixtures" when it is fixture — the same posture
//      either way, and the mode never loosens a verdict.
//   5. Deterministic: two builds on the same clock and the same read produce the
//      same decision ids and the same verdicts.
//
// --self-test plants a loosening in the Graph→estate mapping (an unknown
// compliance state read as compliant) and shows claim 2's check catches it.
import { CoreError, SignalGridCore, fixedClock, type EstateSpec, type EstateSubject } from "@workspace/signalgrid-core";
import { createFixtureGraphPostureConnector, toEstateSubjects, type GraphPostureSignal } from "@workspace/integrations/graph";

const SELF_TEST = process.argv.includes("--self-test");
const CLOCK_ISO = "2026-06-16T12:00:00.000Z";
let checks = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail = ""): void {
  checks += 1;
  if (cond) {
    console.log(`  ok — ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL — ${name}${detail ? `: ${detail}` : ""}`);
  }
}

const OWNER = "estate-owner-token-0123456789abcdef";
const OPERATOR = "estate-operator-token-0123456789abcdef";

function spec(subjects: EstateSubject[], mode: "fixture" | "live"): EstateSpec {
  return {
    tenant: { id: "tenant_proof-estate", slug: "proof-estate", name: "Proof estate" },
    principals: [
      { role: "owner", token: OWNER, subjectId: "user_proof_owner" },
      { role: "operator", token: OPERATOR, subjectId: "user_proof_operator" },
    ],
    connector: {
      mode,
      sourceDescription: "the committed Graph fixture dataset",
      permissionScope: "DeviceManagementManagedDevices.Read.All (read-only)",
      credentialRef: "fixture:no-credential",
    },
    subjects,
  };
}

async function main(): Promise<void> {
  const connector = createFixtureGraphPostureConnector();
  const signals = await connector.fetchPosture(CLOCK_ISO);
  const mapped = SELF_TEST ? plantLoosening(signals) : toEstateSubjects(signals);

  // 1. subjects from the read; ownerless counted; unknown subject not_found
  const ownerless = signals.filter((s) => s.subjectId === null).length;
  ok("every ownerless device is counted, none becomes a subject", mapped.skippedOwnerless === ownerless && mapped.subjects.length === signals.length - ownerless,
    `skipped=${mapped.skippedOwnerless} ownerless=${ownerless} subjects=${mapped.subjects.length} signals=${signals.length}`);
  ok("the fixture read produced subjects to decide about", mapped.subjects.length > 0);

  const core = SignalGridCore.fromEstate(fixedClock(CLOCK_ISO), spec(mapped.subjects, "fixture"));
  let notFound = false;
  try {
    core.evaluate(OPERATOR, { identityRef: "nobody-the-source-reported", deviceRef: mapped.subjects[0]!.device.externalRef, workflowKey: "shared-device-session" });
  } catch (err) {
    notFound = err instanceof CoreError && err.status === 404;
  }
  ok("a subject the source never reported is not_found, not guessed", notFound);

  // 2. no allow without encryption/OS facts; disabled and unknown fail closed hard
  const verdicts = new Map<string, string>();
  for (const subject of mapped.subjects) {
    const result = core.evaluate(OPERATOR, {
      identityRef: subject.identity.externalRef,
      deviceRef: subject.device.externalRef,
      workflowKey: "shared-device-session",
    });
    verdicts.set(subject.device.externalRef, result.outcome);
  }
  const allowed = [...verdicts.entries()].filter(([, v]) => v === "allow").map(([k]) => k);
  ok("no estate subject is allowed while encryption and OS support are unread", allowed.length === 0, `allowed=${allowed.join(",")}`);
  const disabled = mapped.subjects.filter((s) => s.identity.state === "disabled");
  ok("a disabled identity is denied or restricted, never merely stepped up", disabled.length > 0 && disabled.every((s) => ["deny", "restrict"].includes(verdicts.get(s.device.externalRef)!)),
    disabled.map((s) => `${s.device.externalRef}=${verdicts.get(s.device.externalRef)}`).join(" "));
  const unknownCompliance = mapped.subjects.filter((s) => s.posture.compliance === "unknown");
  ok("an unknown-compliance device is never allowed (the policy's own rule decides between step_up and restrict)", unknownCompliance.length > 0 && unknownCompliance.every((s) => verdicts.get(s.device.externalRef) !== "allow"),
    unknownCompliance.map((s) => `${s.device.externalRef}=${verdicts.get(s.device.externalRef)}`).join(" "));
  const nonCompliantFromGrace = signals.filter((s) => s.deviceComplianceState === "in_grace_period" && s.subjectId !== null);
  ok("in_grace_period never maps to compliant", nonCompliantFromGrace.every((s) => mapped.subjects.find((m) => m.device.externalRef === s.deviceId)?.posture.compliance === "non_compliant"));

  // 3. not a demo core
  let demoRefused = false;
  try {
    core.demoApiKeys();
  } catch (err) {
    demoRefused = err instanceof CoreError && err.status === 403;
  }
  ok("demoApiKeys() refuses on an estate core", demoRefused && core.isDemo() === false);
  let shortRefused = false;
  try {
    SignalGridCore.fromEstate(fixedClock(CLOCK_ISO), { ...spec(mapped.subjects, "fixture"), principals: [{ role: "owner", token: "short", subjectId: "u" }] });
  } catch (err) {
    shortRefused = err instanceof CoreError && err.status === 400;
  }
  ok("a short principal token is refused at build", shortRefused);
  let demoShapedRefused = false;
  try {
    SignalGridCore.fromEstate(fixedClock(CLOCK_ISO), { ...spec(mapped.subjects, "fixture"), principals: [{ role: "owner", token: "sgk_demo_northwind_owner_padded_out", subjectId: "u" }] });
  } catch (err) {
    demoShapedRefused = err instanceof CoreError && err.status === 400;
  }
  ok("a demo-shaped principal token is refused at build", demoShapedRefused);

  // 4. signalSource derives from the held connector; mode never loosens
  const live = SignalGridCore.fromEstate(fixedClock(CLOCK_ISO), spec(mapped.subjects, "live"));
  ok("signalSource() is fixtures for a fixture connector and live for a live one", core.signalSource() === "fixtures" && live.signalSource() === "live");
  const liveVerdicts = mapped.subjects.map((s) => live.evaluate(OPERATOR, { identityRef: s.identity.externalRef, deviceRef: s.device.externalRef, workflowKey: "shared-device-session" }).outcome);
  ok("a live-mode connector yields the same verdicts as fixture mode on the same posture", liveVerdicts.every((v, i) => v === verdicts.get(mapped.subjects[i]!.device.externalRef)));

  // 5. determinism
  const once = SignalGridCore.fromEstate(fixedClock(CLOCK_ISO), spec(mapped.subjects, "fixture"));
  const again = SignalGridCore.fromEstate(fixedClock(CLOCK_ISO), spec(mapped.subjects, "fixture"));
  const first = mapped.subjects.map((s) => once.evaluate(OPERATOR, { identityRef: s.identity.externalRef, deviceRef: s.device.externalRef, workflowKey: "shared-device-session" }).decisionId);
  const second = mapped.subjects.map((s) => again.evaluate(OPERATOR, { identityRef: s.identity.externalRef, deviceRef: s.device.externalRef, workflowKey: "shared-device-session" }).decisionId);
  ok("two builds on the same clock and read mint the same decision ids", first.every((id, i) => id === second[i]));

  console.log(`\nestate-core proof: ${checks - failed}/${checks} checks passed (${mapped.subjects.length} subjects from ${signals.length} Graph signals, ${mapped.skippedOwnerless} ownerless skipped)`);
  // The line check-proof-counts.mjs reads to hold "(N checks)" in the docs against the proof.
  console.log(`summary=${failed === 0 ? "pass" : "fail"} (${checks - failed}/${checks})`);
  if (SELF_TEST) {
    if (failed > 0) {
      console.log("self-test: the planted loosening (unknown compliance read as compliant) was CAUGHT — the proof can fail.");
      process.exit(0);
    }
    console.log("self-test: the planted loosening was NOT caught — the proof cannot fail.");
    process.exit(1);
  }
  process.exit(failed > 0 ? 1 : 0);
}

/** Self-test mutation: an unknown compliance state read as compliant — the loosening claim 2 exists to catch. */
function plantLoosening(signals: readonly GraphPostureSignal[]): ReturnType<typeof toEstateSubjects> {
  const mapped = toEstateSubjects(signals);
  for (const subject of mapped.subjects) {
    if (subject.posture.compliance === "unknown") subject.posture.compliance = "compliant";
  }
  return mapped;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
