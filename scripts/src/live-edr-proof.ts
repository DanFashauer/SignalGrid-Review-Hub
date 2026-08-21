// Proof: the edr-threat connector against a REAL Wazuh server.
//
// Every other edr-threat assertion runs on fixtures we wrote, so they agree with
// us by construction. This one reads a live Wazuh API and asks a question
// fixtures cannot answer: when a real vendor does not report a field, what does
// the connector do with the absence?
//
// WHAT WAZUH ACTUALLY SUPPLIES (measured, not assumed — Wazuh 4.9.0 /agents):
//   deviceId       ← id
//   agentInstalled ← the agent is enrolled at all
//   agentRunning   ← status === "active"
//   lastSeen       ← lastKeepAlive
//
// WHAT IT DOES NOT, AT THIS ENDPOINT:
//   realtimeProtection — Wazuh is HIDS/XDR, not signature-based AV; it has no
//                        such concept, so there is nothing honest to map.
//   signatureAgeHours  — same reason: no signature/definition set exists.
//   threats[]          — alerts live in the Wazuh INDEXER, a separate service.
//
// The temptation is to map the missing three to something cheerful so the
// dashboard looks complete. That is precisely the fabrication this repo keeps
// finding (syslog reporting 'sent' for a no-op). They are left ABSENT, and the
// proof's real subject is what the connector then does: `realtimeProtection`
// normalizes to false — NOT protected — rather than assuming protection it never
// observed, and signatureAgeHours becomes null rather than 0 (which would read
// as "freshly updated").
//
// Refuses loudly without a server, like proof:enrollment-race: an EDR proof with
// no EDR is not a passing proof.
//
//   docker run -d --name sg-wazuh -p 55000:55000 wazuh/wazuh-manager:4.9.0
//   WAZUH_URL=https://127.0.0.1:55000 WAZUH_USER=wazuh WAZUH_PASS=wazuh \
//     pnpm run proof:live-edr

import { normalizeEndpoint, evaluateThreatPosture, type EndpointThreatRaw } from "@workspace/integrations/edr-threat";

const BASE = process.env.WAZUH_URL?.replace(/\/$/, "");
const USER = process.env.WAZUH_USER ?? "wazuh";
const PASS = process.env.WAZUH_PASS ?? "wazuh";

if (!BASE) {
  console.error(
    "proof:live-edr REFUSED — no WAZUH_URL set.\n" +
      "This proof exists to read a REAL EDR server; without one there is nothing it\n" +
      "could honestly report. Start one and re-run (the lane script does all of\n" +
      "this for you: ./scripts/run-live-lanes.sh --only edr):\n" +
      "  docker run -d --name sg-wazuh -p 55000:55000 wazuh/wazuh-manager:4.14.7\n" +
      "  docker cp sg-wazuh:/var/ossec/api/configuration/ssl/server.crt /tmp/sg-wazuh-ca.crt\n" +
      "  NODE_EXTRA_CA_CERTS=/tmp/sg-wazuh-ca.crt WAZUH_URL=https://localhost:55000 \\\n" +
      "    pnpm run proof:live-edr\n" +
      "(localhost, not 127.0.0.1 — the container cert's SAN is DNS:localhost only.\n" +
      "4.14.7, not 4.9.0 — 4.9.0 is published amd64-only and DIES under QEMU on\n" +
      "Apple Silicon: segfault in wazuh-modulesd. Measured 2026-08-21.)\n",
  );
  process.exit(1);
}

// VERIFICATION IS NEVER DISABLED. An earlier revision set
// NODE_TLS_REJECT_UNAUTHORIZED=0 here — globally, for the whole process —
// which is the exact doctrine the Fleet lane was built to avoid (mint or
// extract the lab CA, trust it EXPLICITLY). The lane script exports
// NODE_EXTRA_CA_CERTS pointing at the container's own API certificate; a
// caller running this proof by hand must do the same. An https target with
// no explicit trust anchor is REFUSED, not "handled".
if (BASE.startsWith("https:") && !process.env.NODE_EXTRA_CA_CERTS) {
  console.error(
    "proof:live-edr REFUSED — https target with no NODE_EXTRA_CA_CERTS.\n" +
      "This proof never disables TLS verification. Extract the lab cert and\n" +
      "trust it explicitly (run-live-lanes.sh does this automatically):\n" +
      "  docker cp sg-wazuh:/var/ossec/api/configuration/ssl/server.crt /tmp/sg-wazuh-ca.crt\n" +
      "  NODE_EXTRA_CA_CERTS=/tmp/sg-wazuh-ca.crt WAZUH_URL=... pnpm run proof:live-edr\n",
  );
  process.exit(1);
}

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

interface WazuhAgent {
  id?: string;
  status?: string;
  lastKeepAlive?: string;
  name?: string;
}

/** The one summary path — reached by a full run and by the empty-inventory
 *  early return alike, so a deterministic failure always reports itself. */
function finish(): void {
  const total = passed + failures.length;
  console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
  if (failures.length > 0) {
    console.error("failed:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("edr-threat verified against a live Wazuh: absent vendor fields fail closed, never assumed good.");
}

async function main(): Promise<void> {
  // 1. Real authentication against the real server.
  const authRes = await fetch(`${BASE}/security/user/authenticate`, {
    headers: { Authorization: `Basic ${Buffer.from(`${USER}:${PASS}`).toString("base64")}` },
  });
  check("authenticated against the live Wazuh API", authRes.status === 200, `status=${authRes.status}`);
  if (authRes.status !== 200) throw new Error("cannot continue without a token");
  const token = ((await authRes.json()) as { data: { token: string } }).data.token;
  check("the server issued a bearer token", typeof token === "string" && token.length > 0);

  // 2. Real agent inventory.
  const agentsRes = await fetch(`${BASE}/agents?limit=50`, { headers: { Authorization: `Bearer ${token}` } });
  check("read the live agent inventory", agentsRes.status === 200, `status=${agentsRes.status}`);
  const agents = ((await agentsRes.json()) as { data: { affected_items: WazuhAgent[] } }).data.affected_items;
  check("the server reports at least one agent", agents.length > 0, `count=${agents.length}`);

  // 3. Translate ONLY what Wazuh genuinely reports. The three fields it has no
  //    concept of are left undefined on purpose — inventing them is the failure
  //    this proof is written to prevent.
  const raw: EndpointThreatRaw[] = agents.map((a) => ({
    deviceId: String(a.id ?? "unknown"),
    agentInstalled: true,
    agentRunning: a.status === "active",
    lastSeen: a.lastKeepAlive,
    source: "wazuh",
    // realtimeProtection / signatureAgeHours / threats: NOT SUPPLIED by Wazuh.
  }));
  check("translated live agents into the connector's raw shape", raw.length === agents.length);

  // 4. The connector's own normalizer, on real data.
  const normalized = raw.map(normalizeEndpoint);
  // Guarded (the 5039ccc class): an empty inventory must FAIL, deterministically
  // and completely — every remaining assertion depends on a first endpoint, so
  // record the one honest failure and stop rather than crash mid-argument (the
  // ?. on one dereference was not enough: the detail strings and the posture
  // section still dereferenced bare).
  const first = normalized[0];
  if (!first) {
    check("the server reports at least one agent (empty inventory: every remaining check depends on one)", false);
    finish();
    return;
  }

  check("agent presence is read from the live server", first.agentInstalled === true);
  check(
    "agent running-state reflects the live status field",
    first.agentRunning === (agents[0].status === "active"),
    `wazuh status=${agents[0].status}`,
  );
  check("the live source is attributed to wazuh", first.source === "wazuh");

  // 5. THE POINT OF THIS PROOF. Wazuh cannot report these; the connector must
  //    treat the silence as "not observed", never as "observed good".
  check(
    "unreported realtime protection grades as NOT protected (never assumed on)",
    first.realtimeProtection === false,
  );
  check(
    "unreported signature age is null, not 0 (0 would read as freshly updated)",
    first.signatureAgeHours === null,
  );

  // 6. And that absence must move the verdict toward caution, not away from it.
  // evaluateThreatPosture grades ONE endpoint, not a collection.
  const posture = evaluateThreatPosture(first);
  check("a posture verdict is produced from live data", typeof posture === "object" && posture !== null);
  check(
    "the verdict names a posture, a recommended action and a reason code",
    typeof posture.posture === "string" &&
      typeof posture.recommendedAction === "string" &&
      typeof posture.reasonCode === "string",
    JSON.stringify(posture),
  );
  // The measured outcome, pinned so a future change that starts trusting silence
  // fails here: a live agent with UNOBSERVED protection is graded
  // degraded_protection / PROTECTION_DEGRADED and raised to step_up.
  check("unobserved protection raises the endpoint to step_up", posture.recommendedAction === "step_up", `action=${posture.recommendedAction}`);
  check("…and names PROTECTION_DEGRADED as the reason", posture.reasonCode === "PROTECTION_DEGRADED", `reason=${posture.reasonCode}`);
  check("…and reports protectionHealthy false", posture.protectionHealthy === false);
  // Absent realtime protection must move the verdict toward caution. A live agent
  // that is up but whose protection state was never observed is NOT "clean".
  check(
    "an endpoint with unobserved protection is not graded protected/clean",
    !["clean", "healthy", "protected"].includes(posture.posture),
    `posture=${posture.posture} action=${posture.recommendedAction} reason=${posture.reasonCode}`,
  );

  console.log(`\n  measured: wazuh supplied ${Object.keys(raw[0]).length} of 8 EndpointThreatRaw fields`);

  finish();
}

main().catch((err) => {
  console.error(`proof:live-edr crashed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
