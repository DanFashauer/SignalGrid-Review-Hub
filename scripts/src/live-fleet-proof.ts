// Proof: the telemetry/fleetdm adapter against a REAL Fleet server.
//
// Fleet Free is perpetual, self-hosted and has no trial clock, so this lane can
// run forever. What it bought is not reassurance — it is a bug report. Every
// host- and policy-level route the adapter used was WRONG, and no fixture could
// ever have said so, because the fixtures were written from the same wrong
// assumptions as the code.
//
// MEASURED against Fleet 4.89.2 (see docs/FLEET_LIVE_INTEGRATION.md):
//
//   adapter used                      real Fleet 4.89.2
//   ────────────────────────────────  ──────────────────────────────────────────
//   GET /fleet/policies               404 — it is /fleet/global/policies
//   GET /fleet/hosts/{uuid}           404 — that route takes a NUMERIC id;
//                                     a UUID needs /hosts/identifier/{uuid}
//   /hosts/{id} → bare host           returns a { host: ... } ENVELOPE, so the
//                                     old `as Promise<FleetDMHost>` cast yielded
//                                     an object whose every field is undefined
//   GET /hosts/{id}/policies          404 — results embed in the host under
//                                     ?populate_policies=true
//   policy_id/_name/_response         id / name / response
//   host.serial_number                host.hardware_serial
//   POST /queries/run {host_ids}      400 "no hosts targeted" — and even the body
//                                     Fleet accepts returns { campaign: ... }, not
//                                     results: a live query is asynchronous, rows
//                                     stream over a WEBSOCKET. `data.results` was
//                                     always undefined despite its array type.
//
// The one thing that DID work was `testConnection` (GET /fleet/config → 200).
// That is the trap this proof exists to close: the integration's own health check
// reported "Successfully connected to FleetDM" while every substantive read
// 404'd. A connection test that cannot detect a completely non-functional
// integration is worse than no connection test, because it manufactures
// confidence.
//
// The saving grace, asserted below rather than assumed: the adapter failed
// CLOSED. getHost 404 → null → getPostureForHost → null, and `compliant` requires
// at least one policy AND all of them passing. A broken read never became a
// cheerful verdict. That property is pinned here so the fix cannot trade
// correctness for optimism.
//
// Refuses loudly without a server, like proof:live-edr and proof:enrollment-race:
// a Fleet proof with no Fleet is not a passing proof.
//
//   see docs/FLEET_LIVE_INTEGRATION.md for the one-command stack
//   FLEET_URL=http://127.0.0.1:8412 FLEET_TOKEN=... pnpm run proof:live-fleet

import { FleetDMAdapter, setFleetDMConfig } from "@workspace/integrations/telemetry";
import { fleetDMToPostureDrafts } from "@workspace/integration-bridge";

const BASE = process.env.FLEET_URL?.replace(/\/$/, "");
const TOKEN = process.env.FLEET_TOKEN ?? "";
const HOST_UUID = process.env.FLEET_HOST_UUID ?? "11111111-2222-3333-4444-555555555555";

if (!BASE || !TOKEN) {
  console.error(
    "proof:live-fleet REFUSED — needs FLEET_URL and FLEET_TOKEN.\n" +
      "This proof exists to read a REAL Fleet server; without one there is nothing\n" +
      "it could honestly report. See docs/FLEET_LIVE_INTEGRATION.md to bring one up.\n",
  );
  process.exit(1);
}

// Re-bound after the guard above: the module-level narrowing of `BASE` does not
// reach into the closures below, and widening each use site with `!` would assert
// rather than establish.
const FLEET_BASE: string = BASE;

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed += 1;
    console.log(`  ok — ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗  — ${name}${detail ? ` (${detail})` : ""}`);
  }
}

/** Raw call, bypassing the adapter — used to pin what the server really does. */
async function raw(path: string, init?: RequestInit): Promise<{ status: number; body: string }> {
  const res = await fetch(`${FLEET_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  return { status: res.status, body: await res.text() };
}

async function main(): Promise<void> {
  process.env.FLEETDM_BASE_URL = FLEET_BASE;
  process.env.FLEETDM_API_TOKEN = TOKEN;

  // ── 1. The tier gate bites against a REACHABLE server ─────────────────────
  // Every other assertion about the gate is made in-process against no network at
  // all. Here a real Fleet is up, reachable and authenticated, and the adapter
  // must still refuse — that is the only version of the claim that means
  // anything. runQuery in particular POSTs arbitrary osquery SQL to real hosts.
  process.env.SIGNALGRID_TIER = "dev";
  process.env.SIGNALGRID_LIVE_INTEGRATIONS = "true";
  await setFleetDMConfig({ enabled: true, baseUrl: FLEET_BASE, apiToken: TOKEN, syncIntervalMs: 300000 });

  const devAdapter = new FleetDMAdapter();
  await devAdapter.initialize();
  check("tier dev: isEnabled() false even with the operator flag on and a live server up", !devAdapter.isEnabled());
  check("tier dev: getHosts() returns empty against a REACHABLE Fleet", (await devAdapter.getHosts()).length === 0);
  check("tier dev: getPostureForHost() returns null, not a posture", (await devAdapter.getPostureForHost(HOST_UUID)) === null);
  let devQueryThrew = false;
  try {
    await devAdapter.runQuery("SELECT 1;", [1]);
  } catch {
    devQueryThrew = true;
  }
  check("tier dev: runQuery() sends no osquery SQL at all", devQueryThrew);

  // ── 2. Now the live tier ──────────────────────────────────────────────────
  process.env.SIGNALGRID_TIER = "prod";
  const fleet = new FleetDMAdapter();
  await fleet.initialize();
  check("tier prod + flag: the adapter reports enabled", fleet.isEnabled());

  // ── 3. What already worked ────────────────────────────────────────────────
  const conn = await fleet.testConnection();
  check("testConnection succeeds against the live server", conn.success, conn.message);
  // It must now prove it did more than ping /config — that is the whole point of
  // the change, and a message-free success would let the old behaviour return.
  check("…and it reports a SUBSTANTIVE read, not just a reachable config endpoint",
    /inventory read OK/.test(conn.message), conn.message);

  const hosts = await fleet.getHosts();
  check("getHosts reads the live inventory", hosts.length > 0, `count=${hosts.length}`);
  const target = hosts.find((h) => h.uuid === HOST_UUID) ?? hosts[0];
  check("the enrolled host carries a real numeric id and uuid", typeof target.id === "number" && !!target.uuid);

  // ── 4. THE POINT: the routes that were wrong ──────────────────────────────
  // Each is asserted twice — the old path still fails on the real server, and the
  // adapter now takes the one that works. Pinning both makes the fix falsifiable:
  // if someone reverts the URL, this fails; if Fleet ever changes it, this fails
  // too, which is exactly when we want to hear about it.
  const oldHost = await raw(`/api/v1/fleet/hosts/${HOST_UUID}`);
  check("the OLD host route (uuid into /hosts/{id}) really is 404 on a live Fleet", oldHost.status === 404, `status=${oldHost.status}`);

  const byId = await raw(`/api/v1/fleet/hosts/${target.id}`);
  const byIdJson = JSON.parse(byId.body) as Record<string, unknown>;
  check("…and /hosts/{id} answers with a { host } envelope, not a bare host",
    byId.status === 200 && "host" in byIdJson && byIdJson.platform === undefined);

  const host = await fleet.getHost(HOST_UUID);
  check("getHost(uuid) now resolves a real host", host !== null);
  check("…and its fields are POPULATED (the envelope is unwrapped, not cast)",
    !!host && typeof host.platform === "string" && host.platform.length > 0,
    `platform=${host?.platform}`);

  const oldPolicies = await raw("/api/v1/fleet/policies");
  check("the OLD global-policies route really is 404 on a live Fleet", oldPolicies.status === 404, `status=${oldPolicies.status}`);
  const policies = await fleet.getPolicies();
  check("getPolicies now reads the live global policies", policies.length > 0, `count=${policies.length}`);

  const oldHostPolicies = await raw(`/api/v1/fleet/hosts/${target.id}/policies`);
  check("the OLD host-policies route really is 404 (Fleet has no such endpoint)", oldHostPolicies.status === 404, `status=${oldHostPolicies.status}`);
  const results = await fleet.getPolicyResultsForHost(HOST_UUID);
  check("getPolicyResultsForHost now returns the host's live policy results", results.length > 0, `count=${results.length}`);

  // ── 5. The unanswered policy — absence must not become good news ──────────
  // A policy the host has not yet reported on comes back from Fleet as the EMPTY
  // STRING. This is the live analogue of proof:live-edr's absent fields: it must
  // become `unknown`, never `pass`.
  const unanswered = results.find((r) => r.policy_response === "unknown");
  check("an unreported policy is graded `unknown`, never `pass`", unanswered !== undefined,
    `responses=${results.map((r) => r.policy_response).join(",")}`);
  check("no policy result is silently invented as passing",
    results.every((r) => ["pass", "fail", "unknown"].includes(r.policy_response)));

  // ── 6. And that must carry through to the verdict ─────────────────────────
  const posture = await fleet.getPostureForHost(HOST_UUID);
  check("a posture signal is produced from live data", posture !== null);
  check("the host is NOT compliant when its policies are unanswered (fail closed)", posture?.compliant === false);
  check("the platform comes from the live host", posture?.platform === host?.platform, `posture=${posture?.platform}`);
  // Anchored to Fleet's WIRE value (the raw /hosts/{id} envelope fetched above),
  // not to the adapter's own host object — comparing the adapter to itself would
  // pass even if both mapped the wrong field. Equality with the wire value plus
  // the string type-check is what proves sourcing: the old `host.serial_number`
  // bug yielded undefined, which fails the type-check. Non-emptiness is NOT
  // required, because a containerized/virtual lab host legitimately reports an
  // empty hardware serial — an empty string that MATCHES the wire is honest;
  // a non-empty string that doesn't match it would be the actual bug.
  const wireSerial = (byIdJson.host as Record<string, unknown>).hardware_serial;
  check("rawSignals.serial_number is sourced from Fleet's real hardware_serial",
    typeof wireSerial === "string" &&
      typeof posture?.rawSignals?.serial_number === "string" &&
      posture.rawSignals.serial_number === wireSerial,
    `serial=${String(posture?.rawSignals?.serial_number)} wire=${String(wireSerial)}`);

  // ── 7. The bridge that consumes it ────────────────────────────────────────
  const drafts = fleetDMToPostureDrafts(posture!);
  const compliance = drafts.find((d) => d.category === "device_compliance");
  check("the bridge maps an unanswered-policy host to non_compliant", compliance?.value === "non_compliant", `value=${String(compliance?.value)}`);

  // ── 8. An unknown host yields nothing, not a blank posture ────────────────
  const ghost = await fleet.getPostureForHost("00000000-0000-0000-0000-000000000000");
  check("an unknown host returns null rather than an empty-but-compliant posture", ghost === null);

  // ── 9. runQuery: the campaign collector and its three-gate stack ──────────
  // This is the one method that POSTs arbitrary osquery SQL to real production
  // hosts, so the standard of evidence for arming it is high. The wire facts
  // that killed the old implementation are still measured first (the old body
  // is still 400; the accepted body still answers with a campaign, not rows),
  // then the gates are asserted one at a time, then a real campaign is
  // collected over the websocket from the live agent.
  const oldBody = await raw("/api/v1/fleet/queries/run", {
    method: "POST",
    body: JSON.stringify({ query: "SELECT 1;", host_ids: [target.id] }),
  });
  check("the OLD runQuery body really is rejected 400 by a live Fleet", oldBody.status === 400, `status=${oldBody.status}`);

  // …and even the body Fleet DOES accept returns no results: a live query is an
  // asynchronous campaign, with rows streaming over a websocket. `data.results`
  // was therefore always undefined — an array-typed value that was never an array.
  const accepted = await raw("/api/v1/fleet/queries/run", {
    method: "POST",
    body: JSON.stringify({ query: "SELECT 1;", selected: { hosts: [target.id] } }),
  });
  const acceptedJson = JSON.parse(accepted.body) as Record<string, unknown>;
  check("a correctly-formed live query is accepted…", accepted.status === 200, `status=${accepted.status}`);
  check("…but answers with a `campaign`, NOT a results array (so there is nothing to return synchronously)",
    "campaign" in acceptedJson && acceptedJson.results === undefined,
    `keys=${Object.keys(acceptedJson).join(",")}`);

  // The collector exists now, so what is pinned is the GATE STACK around it —
  // three independent refusals, each asserted from the side that must hold —
  // and then, with every gate deliberately opened, a REAL collection from the
  // live enrolled osqueryd. Each refusal is checked with the OTHER gates open,
  // so a pass proves that gate alone did the refusing.
  delete process.env.SIGNALGRID_ALLOW_LIVE_QUERY;
  let noApprovalMsg = "";
  try {
    await fleet.runQuery("SELECT 1;", [target.id]);
  } catch (e) {
    noApprovalMsg = e instanceof Error ? e.message : String(e);
  }
  check("live tier + flag alone do NOT arm runQuery: it refuses without the explicit approval env",
    /SIGNALGRID_ALLOW_LIVE_QUERY/.test(noApprovalMsg), noApprovalMsg.slice(0, 80));

  process.env.SIGNALGRID_ALLOW_LIVE_QUERY = "true";
  process.env.SIGNALGRID_TIER = "dev";
  let devApprovedMsg = "";
  try {
    await fleet.runQuery("SELECT 1;", [target.id]);
  } catch (e) {
    devApprovedMsg = e instanceof Error ? e.message : String(e);
  }
  check("…and approval does NOT bypass the tier chokepoint: dev tier still refuses with approval set",
    /not enabled/i.test(devApprovedMsg), devApprovedMsg.slice(0, 80));
  process.env.SIGNALGRID_TIER = "prod";

  let noHostsMsg = "";
  try {
    await fleet.runQuery("SELECT 1;", []);
  } catch (e) {
    noHostsMsg = e instanceof Error ? e.message : String(e);
  }
  check("an empty host list is refused — a fleet-wide broadcast is never implied",
    /no target hosts/i.test(noHostsMsg), noHostsMsg.slice(0, 80));

  // Every gate open, one named host: rows must come back over the websocket
  // from the real agent, attributed to that host, with partial=false. The
  // window is generous because the agent polls distributed queries on its own
  // interval — the collection is asynchronous end to end.
  const report = await fleet.runQuery("SELECT version FROM osquery_info;", [target.id], { timeoutMs: 45000 });
  check("the campaign is collected: a real campaign id and the targeted host responded",
    typeof report.campaignId === "number" && report.hostsTargeted === 1 && report.hostsResponded === 1,
    `campaign=${report.campaignId} responded=${report.hostsResponded}/${report.hostsTargeted}`);
  check("…the rows are REAL agent output (osquery_info.version is a non-empty string)",
    report.results.length > 0 &&
      report.results[0].rows.length > 0 &&
      typeof report.results[0].rows[0].version === "string" &&
      (report.results[0].rows[0].version as string).length > 0,
    `rows=${JSON.stringify(report.results[0]?.rows ?? []).slice(0, 80)}`);
  check("…attributed to the host that ran them, with no per-host error",
    report.results[0].host_id === target.id && report.results[0].error === null,
    `host_id=${report.results[0]?.host_id} error=${String(report.results[0]?.error)}`);
  check("…and a fully-answered window is NOT flagged partial", report.partial === false);

  // The partial flag is asserted from ITS side too: a window too short for any
  // agent to answer must come back partial with zero hosts responded and zero
  // invented rows — truncation reported as truncation, never as an empty-but-
  // complete answer.
  const truncated = await fleet.runQuery("SELECT version FROM osquery_info;", [target.id], { timeoutMs: 1 });
  check("a window that closes early is flagged partial, with nothing invented",
    truncated.partial === true && truncated.hostsResponded === 0 && truncated.results.length === 0,
    `partial=${truncated.partial} responded=${truncated.hostsResponded} results=${truncated.results.length}`);
  delete process.env.SIGNALGRID_ALLOW_LIVE_QUERY;

  // ── 10. The operator flag is still a real off switch ──────────────────────
  await setFleetDMConfig({ enabled: false, baseUrl: FLEET_BASE, apiToken: TOKEN, syncIntervalMs: 300000 });
  const offAdapter = new FleetDMAdapter();
  await offAdapter.initialize();
  check("operator flag off: reads stop even in a live tier", !offAdapter.isEnabled() && (await offAdapter.getHosts()).length === 0);

  const total = passed + failures.length;
  console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
  if (failures.length > 0) {
    console.error("failed:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("telemetry/fleetdm verified against a live Fleet: routes corrected, unanswered policies fail closed, live-query campaign collected over websocket behind its three-gate stack.");
}

main().catch((err) => {
  console.error(`proof:live-fleet crashed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
