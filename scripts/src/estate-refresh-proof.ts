// Proof: the estate posture REFRESH loop re-decides, and it fails closed.
//
// `SignalGridCore.fromEstate()` reads posture ONCE, at boot. A deployment whose
// answers are pinned to the moment it started is the unearned affirmative on a
// clock: the device that fell out of compliance an hour ago still gets the verdict
// it earned at boot. The refresh is the other half — and the half that can go wrong
// quietly, because a loop that silently stopped applying anything looks exactly like
// an estate that stopped changing.
//
// Claims:
//   1. A refresh re-runs the SAME sync: one ConnectorSyncRun per pass, recorded on
//      the connector, and the verdicts move with the new posture.
//   2. The skip-and-count rule is unchanged. A refresh carrying a record for a
//      subject this tenant does not hold SKIPS it, COUNTS it, reports `partial`
//      (never `success`), and leaves the connector `degraded` (never `healthy`).
//   3. A refresh can only tighten on absence. Posture that goes from compliant to
//      unknown moves the verdict away from allow; the reverse needs a real
//      affirmative from the source. A run that carries NO records confirms nothing:
//      partial, degraded, every prior fact retracted (DR-059). A refresh that omits
//      a fact retracts that fact, and a posture never refreshed AGES at decision time.
//   4. Never in demo mode: `refreshEstatePosture` refuses (403) on a demo core,
//      which holds no estate connector.
//   5. Deterministic: the core reads no wall time. Two cores stepped through the
//      same clock and the same refreshes mint the same sync-run ids and the same
//      verdicts.
//
// --self-test plants the loosening claim 3 exists to catch: a refresh that reads an
// unknown compliance state as compliant.
import {
  CoreError,
  SignalGridCore,
  type Clock,
  type EstateSpec,
  type EstateSubject,
  type FixturePostureRecord,
} from "@workspace/signalgrid-core";

const SELF_TEST = process.argv.includes("--self-test");
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

const OWNER = "estate-refresh-owner-token-0123456789";
const OPERATOR = "estate-refresh-operator-token-0123456789";
const START_MS = Date.parse("2026-06-16T12:00:00.000Z");

/**
 * A STEPPING clock, and it is the whole point of the boundary rule: wall time is read
 * by the caller (a server-side interval), never inside the core. Handing the core a
 * clock the proof advances by hand is only possible because the core reads nothing
 * else — swap this for `new Date()` and the deployment behaves identically.
 */
function steppingClock(): Clock & { advanceMinutes: (n: number) => void } {
  let ms = START_MS;
  return {
    now: () => new Date(ms),
    advanceMinutes: (n: number) => {
      ms += n * 60_000;
    },
  };
}

function subject(ref: string, posture: Partial<EstateSubject["posture"]> = {}): EstateSubject {
  return {
    identity: { externalRef: `user-${ref}`, displayName: ref, state: "enabled", assignedRole: "unassigned" },
    device: {
      externalRef: `dev-${ref}`,
      name: ref,
      osPlatform: "ios",
      osVersion: "18.0",
      ownerType: "corporate",
      managementAgent: "intune",
    },
    posture: {
      identityEnabled: true,
      managed: true,
      compliance: "compliant",
      encrypted: true,
      osSupported: true,
      lastSyncAt: new Date(START_MS - 60_000).toISOString(),
      sourceReference: `estate:managedDevices#${ref}`,
      ...posture,
    },
  };
}

function record(s: EstateSubject, posture: Partial<EstateSubject["posture"]> = {}): FixturePostureRecord {
  return {
    deviceRef: s.device.externalRef,
    identityRef: s.identity.externalRef,
    ...s.posture,
    ...posture,
  };
}

function spec(subjects: EstateSubject[]): EstateSpec {
  return {
    tenant: { id: "tenant_refresh-estate", slug: "refresh-estate", name: "Refresh estate" },
    principals: [
      { role: "owner", token: OWNER, subjectId: "user_refresh_owner" },
      { role: "operator", token: OPERATOR, subjectId: "user_refresh_operator" },
    ],
    connector: {
      mode: "fixture",
      sourceDescription: "the proof's synthetic estate read",
      permissionScope: "DeviceManagementManagedDevices.Read.All (read-only)",
      credentialRef: "fixture:no-credential",
    },
    subjects,
  };
}

/** Self-test mutation: the refresh reads an unknown compliance state as compliant. */
function plant(records: FixturePostureRecord[]): FixturePostureRecord[] {
  if (!SELF_TEST) return records;
  return records.map((r) => (r.compliance === "unknown" ? { ...r, compliance: "compliant" as const } : r));
}

function main(): void {
  const clock = steppingClock();
  const healthy = subject("healthy");
  const core = SignalGridCore.fromEstate(clock, spec([healthy]));
  const connectorId = core.listConnectors(OWNER)[0]!.id;

  const verdict = (): string =>
    core.evaluate(OPERATOR, {
      identityRef: healthy.identity.externalRef,
      deviceRef: healthy.device.externalRef,
      workflowKey: "shared-device-session",
    }).outcome;

  // 1. one sync run per pass, and the verdicts move with the posture
  const bootRuns = core.listSyncRuns(OWNER, connectorId).length;
  ok("the boot read recorded exactly one sync run", bootRuns === 1, `runs=${bootRuns}`);
  const bootVerdict = verdict();
  ok("the boot posture decides (a fully-read, compliant, managed subject is allowed)", bootVerdict === "allow", bootVerdict);

  clock.advanceMinutes(5);
  const degraded = core.refreshEstatePosture(plant([record(healthy, { compliance: "unknown" })]));
  ok("a refresh records ANOTHER sync run", core.listSyncRuns(OWNER, connectorId).length === bootRuns + 1);
  ok("a clean refresh reports success and leaves the connector healthy",
    degraded.status === "success" && core.listConnectors(OWNER)[0]!.status === "healthy",
    `${degraded.status}/${core.listConnectors(OWNER)[0]!.status}`);
  ok("the refresh actually applied signals", degraded.signalsNormalized > 0 && degraded.recordsProcessed === 1,
    `normalized=${degraded.signalsNormalized} processed=${degraded.recordsProcessed}`);

  // 3. compliant -> unknown moves AWAY from allow (the direction that must hold)
  const afterUnknown = verdict();
  ok("posture that goes compliant → unknown is no longer allowed", afterUnknown !== "allow", afterUnknown);

  // ...and a real affirmative from the source restores it, so the check above is not
  // passing because the refresh broke evaluation outright.
  clock.advanceMinutes(5);
  core.refreshEstatePosture([record(healthy, { lastSyncAt: clock.now().toISOString() })]);
  ok("a refresh carrying a real affirmative restores allow (the tightening above was the posture, not a broken pipeline)",
    verdict() === "allow");

  // 3b. an EMPTY refresh confirms NOTHING (DR-059). The old assertion — "processes
  // nothing and normalizes nothing" — could not fail for `[]` by construction, and
  // the run it described reported success on a healthy connector while every prior
  // affirmative stood. Now: the run is partial, the connector degraded, every fact the
  // source stopped reporting is retracted to unknown, and the verdict tightens.
  clock.advanceMinutes(5);
  const empty = core.refreshEstatePosture([]);
  ok("a refresh with no records processes nothing and normalizes nothing",
    empty.recordsProcessed === 0 && empty.signalsNormalized === 0);
  ok("…and it is PARTIAL on a DEGRADED connector, never a healthy success",
    empty.status === "partial" && core.listConnectors(OWNER)[0]!.status === "degraded",
    `${empty.status}/${core.listConnectors(OWNER)[0]!.status}`);
  ok("…and it retracts: the verdict after an empty refresh is not the allow the last real read earned",
    verdict() !== "allow", verdict());
  ok("the run note says so", empty.note.includes("nothing was confirmed") && empty.note.includes("retracted"), empty.note);

  // 3c. a refresh that OMITS a fact retracts that fact (DR-059). Before: the upsert
  // kept the last affirmative, so a source that stopped reporting encryption still
  // allowed. Control: the same record WITH the fact restores allow.
  clock.advanceMinutes(5);
  core.refreshEstatePosture([record(healthy, { lastSyncAt: clock.now().toISOString() })]);
  ok("control: a full record after the empty refresh restores allow", verdict() === "allow", verdict());
  clock.advanceMinutes(5);
  const omitted = core.refreshEstatePosture([record(healthy, { encrypted: undefined, lastSyncAt: clock.now().toISOString() })]);
  ok("a refresh that omits encryption retracts it — the verdict leaves allow", verdict() !== "allow", verdict());
  ok("…and the run says what it retracted", omitted.note.includes("retracted"), omitted.note);
  clock.advanceMinutes(5);
  core.refreshEstatePosture([record(healthy, { lastSyncAt: clock.now().toISOString() })]);
  ok("control: reporting encryption again restores allow", verdict() === "allow", verdict());

  // 3d. POSTURE AGES (DR-059). A device read fresh and never refreshed cannot stay
  // fresh: at decision time the reading's own age is folded worst-wins with the
  // value the sync stamped. Forty days with no refresh moves the verdict away from
  // allow; a fresh refresh brings it back.
  clock.advanceMinutes(60 * 24 * 40);
  ok("forty days with no refresh: the posture read fresh at sync no longer allows", verdict() !== "allow", verdict());
  const refreshed = core.refreshEstatePosture([record(healthy, { lastSyncAt: clock.now().toISOString() })]);
  ok("control: a fresh refresh after the gap restores allow", verdict() === "allow" && refreshed.status === "success", `${verdict()}/${refreshed.status}`);

  // 2. the skip-and-count rule, unchanged from the boot sync
  clock.advanceMinutes(5);
  const partial = core.refreshEstatePosture([
    record(healthy),
    { ...record(healthy), deviceRef: "dev-the-tenant-does-not-hold", identityRef: "user-nobody" },
  ]);
  ok("a refresh naming an unknown subject reports partial, never success", partial.status === "partial", partial.status);
  ok("the skipped record is COUNTED out of recordsProcessed", partial.recordsProcessed === 1, `processed=${partial.recordsProcessed}`);
  ok("the skip names itself in the run note", partial.note.includes("does not hold") || partial.note.includes("skipped"), partial.note);
  ok("a partial refresh leaves the connector degraded, never healthy",
    core.listConnectors(OWNER)[0]!.status === "degraded", core.listConnectors(OWNER)[0]!.status);

  // 4. never in demo mode
  let demoRefused = false;
  try {
    SignalGridCore.demo().refreshEstatePosture([]);
  } catch (err) {
    demoRefused = err instanceof CoreError && err.status === 403;
  }
  ok("refreshEstatePosture refuses on a demo core (403) — no refresh in demo mode", demoRefused);

  // 5. determinism: no wall time inside the core
  const replay = (): { ids: string[]; verdicts: string[] } => {
    const c = steppingClock();
    const k = SignalGridCore.fromEstate(c, spec([healthy]));
    const id = k.listConnectors(OWNER)[0]!.id;
    const verdicts: string[] = [];
    for (const compliance of ["unknown", "compliant", "non_compliant"] as const) {
      c.advanceMinutes(5);
      k.refreshEstatePosture([record(healthy, { compliance, lastSyncAt: c.now().toISOString() })]);
      verdicts.push(
        k.evaluate(OPERATOR, {
          identityRef: healthy.identity.externalRef,
          deviceRef: healthy.device.externalRef,
          workflowKey: "shared-device-session",
        }).outcome,
      );
    }
    return { ids: k.listSyncRuns(OWNER, id).map((r) => r.id), verdicts };
  };
  const first = replay();
  const second = replay();
  ok("two cores stepped through the same clock mint the same sync-run ids",
    first.ids.length === 4 && first.ids.every((id, i) => id === second.ids[i]), first.ids.join(","));
  ok("…and the same verdicts", first.verdicts.every((v, i) => v === second.verdicts[i]), first.verdicts.join(","));

  console.log(`\nestate-refresh proof: ${checks - failed}/${checks} checks passed`);
  console.log(`summary=${failed === 0 ? "pass" : "fail"} (${checks - failed}/${checks})`);
  if (SELF_TEST) {
    if (failed > 0) {
      console.log("self-test: the planted loosening (a refreshed unknown compliance read as compliant) was CAUGHT — the proof can fail.");
      process.exit(0);
    }
    console.log("self-test: the planted loosening was NOT caught — the proof cannot fail.");
    process.exit(1);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main();
