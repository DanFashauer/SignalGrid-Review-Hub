// Generate a Postman collection + environment for the SignalGrid API, covering
// the whole real surface the api-server serves: the public demo endpoints and
// the authenticated /v1 product API. Deterministic (stable ids) so the committed
// files only change when the API does.
//
//   node scripts/build-postman.mjs          # regenerate
//   node scripts/build-postman.mjs --check  # verify /v1 coverage vs the OpenAPI spec (CI)
//
// Output: docs/postman/SignalGrid.postman_collection.json
//         docs/postman/SignalGrid.postman_environment.json
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(repo, "docs/postman");

// Stable identifiers so regeneration is a no-op unless the API changes.
const COLLECTION_ID = "51a17e00-51a1-51a1-51a1-5163616c6772"; // fixed, not random

const json = (method, body) => ({
  method,
  header: body ? [{ key: "content-type", value: "application/json" }] : [],
  ...(body ? { body: { mode: "raw", raw: JSON.stringify(body, null, 2) } } : {}),
});

// path is the segment AFTER {{base_url}} (which already ends in /api).
const item = (name, method, path, { body, auth } = {}) => {
  const clean = path.replace(/^\//, "");
  const [pathPart, queryPart] = clean.split("?");
  const url = {
    raw: `{{base_url}}/${clean}`,
    host: ["{{base_url}}"],
    path: pathPart.split("/"),
  };
  if (queryPart) {
    url.query = queryPart.split("&").map((kv) => {
      const [key, value = ""] = kv.split("=");
      return { key, value };
    });
  }
  const request = { ...json(method, body), url };
  if (auth) request.auth = auth;
  return { name, request };
};

const NOAUTH = { type: "noauth" };

// ── Public demo surface (no auth) ────────────────────────────────────────────
const publicFolder = {
  name: "Public demo surface",
  item: [
    item("Health (tier + live-integrations flag)", "GET", "/healthz", { auth: NOAUTH }),
    item("Integrations catalog", "GET", "/integrations", { auth: NOAUTH }),
    item("Integration by id", "GET", "/integrations/{{integrationId}}", { auth: NOAUTH }),
    item("Dashboard metrics", "GET", "/metrics/dashboard", { auth: NOAUTH }),
    item("Decision volume series", "GET", "/metrics/decisions/series", { auth: NOAUTH }),
    item("Recent decisions", "GET", "/decisions?limit=20", { auth: NOAUTH }),
    item("Latest signals", "GET", "/signals/latest?limit=50", { auth: NOAUTH }),
    item("Policies (monitoring)", "GET", "/policies", { auth: NOAUTH }),
    item("Simulator scenarios", "GET", "/simulator/scenarios", { auth: NOAUTH }),
    item("Simulator run", "POST", "/simulator/run", { auth: NOAUTH, body: { scenarioId: "{{scenarioId}}" } }),
  ],
};

// ── Smart-hospital simulation + Signal Radar (no auth) ────────────────────────
const simFolder = {
  name: "Smart hospital · sim + radar",
  item: [
    item("Room-entry scenarios", "GET", "/sim/room-entry/scenarios", { auth: NOAUTH }),
    item("Run room entry (decision → orchestration)", "POST", "/sim/room-entry", { auth: NOAUTH, body: { scenarioId: "compliant-medroom" } }),
    item("Run room entry · complete step-up", "POST", "/sim/room-entry", { auth: NOAUTH, body: { scenarioId: "baseline-drift", stepUpSatisfied: true } }),
    item("Signal catalog (evaluated + candidate)", "GET", "/signals/catalog", { auth: NOAUTH }),
    item("Signal radar (detect novel signals)", "POST", "/signals/radar", {
      auth: NOAUTH,
      body: { signals: [{ category: "identity_state" }, { category: "rtls_location" }, { category: "smart_bed_occupancy", sourceReference: "bed-42" }] },
    }),
  ],
};

// ── /v1 product API (bearer). One item per real route. ───────────────────────
const v1Requests = [
  item("List demo keys", "GET", "/v1/keys", { auth: NOAUTH }),
  item("Context (principal + tenant)", "GET", "/v1/context"),
  item("Evaluate a decision", "POST", "/v1/decisions/evaluate", { body: { identityRef: "nurse.compliant", deviceRef: "ipad-ward-01", workflowKey: "clinical-session" } }),
  item("List decisions", "GET", "/v1/decisions?limit=20"),
  item("Get a decision", "GET", "/v1/decisions/{{decisionId}}"),
  item("Get decision evidence", "GET", "/v1/decisions/{{decisionId}}/evidence"),
  item("Simulate (replay) a decision", "POST", "/v1/decisions/{{decisionId}}/simulate", { body: { policyVersionId: "{{policyVersionId}}" } }),
  item("Get decision resolution", "GET", "/v1/decisions/{{decisionId}}/resolution"),
  item("Resolve a decision", "POST", "/v1/decisions/{{decisionId}}/resolve", { body: {} }),
  item("Metrics", "GET", "/v1/metrics"),
  item("List policies", "GET", "/v1/policies"),
  item("List policy versions", "GET", "/v1/policies/{{policyId}}/versions"),
  item("Create policy draft", "POST", "/v1/policies/{{policyId}}/versions", { body: { name: "Draft policy", rules: [] } }),
  item("Activate a policy version", "POST", "/v1/policies/{{policyId}}/versions/{{policyVersionId}}/activate", { body: {} }),
  item("Run policy tests", "GET", "/v1/policies/{{policyId}}/tests"),
  item("List connectors", "GET", "/v1/connectors"),
  item("Connector sync runs", "GET", "/v1/connectors/{{connectorId}}/sync-runs"),
  item("Trigger connector sync", "POST", "/v1/connectors/{{connectorId}}/sync", { body: {} }),
  item("Audit log", "GET", "/v1/audit"),
  item("Webhooks", "GET", "/v1/webhooks"),
  item("Webhook deliveries", "GET", "/v1/webhooks/deliveries"),
  item("Remediation requests", "GET", "/v1/remediation"),
  item("Approve a remediation", "POST", "/v1/remediation/{{remediationId}}/approve", { body: {} }),
  item("List app-workflow integrations", "GET", "/v1/app-workflows/integrations"),
  item("Gate an app workflow (EMR)", "POST", "/v1/app-workflows/evaluate", { body: { integrationId: "emr-chart", identityRef: "nurse.compliant", deviceRef: "ipad-ward-01" } }),
  // The offline/online conflict, as the reconciler actually meets it: the device
  // holds the NEWER policy and says allow, the connected control plane said deny,
  // and the deny stands. Both provenance booleans are present on every record
  // because omitting either is a 400 — a sample that omitted them would teach the
  // wrong contract.
  item("Reconcile decisions across a partition", "POST", "/v1/decisions/reconcile", {
    body: {
      records: [
        { id: "cloud", outcome: "deny", provenance: { policyVersion: 7, coreNormalizationVersion: 2, evaluatedOffline: false, policyKnownSuperseded: false } },
        { id: "device", outcome: "allow", provenance: { policyVersion: 8, coreNormalizationVersion: 2, evaluatedOffline: true, policyKnownSuperseded: false } },
      ],
      standingBound: { maxStandingSeconds: 3600, elapsedSecondsById: { device: 600 } },
    },
  }),
  // Step-up completion is a real WebAuthn ceremony; the assertion fields below are
  // placeholders a browser's navigator.credentials fills in — Postman can exercise
  // the fail-closed paths (403/409), not mint a genuine release.
  item("Step-up: enrollment options", "POST", "/v1/step-up/enroll/options", { body: { identityRef: "nurse.baseline_drift" } }),
  item("Step-up: verify enrollment", "POST", "/v1/step-up/enroll/verify", { body: { identityRef: "nurse.baseline_drift", challengeId: "{{stepUpChallengeId}}", response: { id: "{{credentialId}}", rawId: "{{credentialId}}", type: "public-key", response: { clientDataJSON: "…", attestationObject: "…" } } } }),
  item("Step-up: auth challenge (action-bound)", "POST", "/v1/step-up/challenge", { body: { identityRef: "nurse.baseline_drift", integrationId: "bcma", deviceRef: "ipad-ward-06", actionKey: "controlled.administer" } }),
  item("Complete step-up (release held plan)", "POST", "/v1/app-workflows/complete-step-up", { body: { integrationId: "bcma", identityRef: "nurse.baseline_drift", deviceRef: "ipad-ward-06", actionKey: "controlled.administer", challengeId: "{{stepUpChallengeId}}", assertion: { id: "{{credentialId}}", rawId: "{{credentialId}}", type: "public-key", response: { clientDataJSON: "…", authenticatorData: "…", signature: "…" } } } }),
  item("Start a device session", "POST", "/v1/sessions/start", { body: { identityRef: "nurse.compliant", deviceRef: "ipad-ward-01", workflowKey: "clinical-session", ttlSeconds: 900 } }),
  item("Get a session", "GET", "/v1/sessions/{{sessionId}}"),
  item("Refresh a session", "POST", "/v1/sessions/{{sessionId}}/refresh", { body: {} }),
  item("End a session", "POST", "/v1/sessions/{{sessionId}}/end", { body: {} }),
];
const v1Folder = { name: "/v1 product API (bearer)", item: v1Requests };

// ── Control plane (/cp/v1) — public management surface (no auth) ──────────────
const cpRequests = [
  item("Tenants", "GET", "/cp/v1/tenants", { auth: NOAUTH }),
  item("Sites", "GET", "/cp/v1/sites", { auth: NOAUTH }),
  item("Edge nodes (decision planes)", "GET", "/cp/v1/edge-nodes", { auth: NOAUTH }),
  item("Fleet devices", "GET", "/cp/v1/fleet", { auth: NOAUTH }),
  item("Policy bundle (config down)", "GET", "/cp/v1/policy-bundle?tenant=tenant_northwind", { auth: NOAUTH }),
  item("Edge sync plan", "GET", "/cp/v1/sync/{{nodeId}}", { auth: NOAUTH }),
  item("Ingest telemetry (up)", "POST", "/cp/v1/telemetry", { auth: NOAUTH, body: { nodeId: "{{nodeId}}", windowMins: 1440, decisions: 4200, allow: 3444, stepUp: 420, restrict: 210, deny: 126 } }),
  item("Fleet health rollup", "GET", "/cp/v1/health", { auth: NOAUTH }),
  item("Operational intelligence", "GET", "/cp/v1/ops-intelligence", { auth: NOAUTH }),
  item("Admin flows (config)", "GET", "/cp/v1/flows", { auth: NOAUTH }),
  item("Flow + signal health", "GET", "/cp/v1/flows/health", { auth: NOAUTH }),
  item("Learned recommendations", "GET", "/cp/v1/recommendations", { auth: NOAUTH }),
  item("Signal discovery + auto-onboard", "GET", "/cp/v1/signal-discovery", { auth: NOAUTH }),
  item("DDM / device-health signals (macOS 27)", "GET", "/cp/v1/ddm", { auth: NOAUTH }),
  item("Fleet MDM host posture (osquery, fixtures)", "GET", "/cp/v1/fleet-mdm", { auth: NOAUTH }),
  item("Grid coverage (situations handled)", "GET", "/cp/v1/grid/coverage", { auth: NOAUTH }),
  item("Signal sourcing (api / native / grid-collected / gap)", "GET", "/cp/v1/grid/sourcing", { auth: NOAUTH }),
  item("Grid config (workflows as code — validation)", "GET", "/cp/v1/grid/config", { auth: NOAUTH }),
  // Query string carried on the URL so the collection demonstrates the parameterised
  // form — a partner-facing call whose whole point is the estate you declare.
  item("Evidence coverage (what YOUR estate can answer)", "GET", "/cp/v1/grid/evidence-coverage?planes=identity,device_management", { auth: NOAUTH }),
  item("Zero-touch provisioning plan (simulated)", "GET", "/cp/v1/grid/provisioning", { auth: NOAUTH }),
  item("App resilience (downtime, PHI-safe)", "GET", "/cp/v1/apps/resilience", { auth: NOAUTH }),
];
const cpFolder = { name: "Control plane (/cp/v1)", item: cpRequests };

const collection = {
  info: {
    _postman_id: COLLECTION_ID,
    name: "SignalGrid API",
    description:
      "The SignalGrid API surface, both the public demo endpoints and the authenticated /v1 product core. " +
      "Public-safe fixtures only — the demo token is a fake, not a real credential. Set {{base_url}} to your server " +
      "(default http://localhost:8080/api) and {{token}} to a demo key from GET /v1/keys.",
    schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
  },
  auth: { type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] },
  item: [publicFolder, simFolder, v1Folder, cpFolder],
  variable: [{ key: "base_url", value: "http://localhost:8080/api" }],
};

const environment = {
  id: "51a17e00-51a1-51a1-51a1-656e7669726f",
  name: "SignalGrid · local",
  values: [
    { key: "base_url", value: "http://localhost:8080/api", enabled: true },
    { key: "token", value: "sgk_demo_northwind_operator", enabled: true },
    { key: "decisionId", value: "", enabled: true },
    { key: "policyId", value: "", enabled: true },
    { key: "policyVersionId", value: "", enabled: true },
    { key: "connectorId", value: "", enabled: true },
    { key: "remediationId", value: "", enabled: true },
    { key: "integrationId", value: "sailpoint", enabled: true },
    { key: "scenarioId", value: "healthcare-shared-ipad", enabled: true },
    { key: "nodeId", value: "edge_nw_general", enabled: true },
  ],
  _postman_variable_scope: "environment",
};

// ── /v1 spec-coverage check ──────────────────────────────────────────────────
const canon = (p) => p.replace(/\{\{[^}]+\}\}/g, "*").replace(/\{[^}]+\}/g, "*").replace(/:[^/]+/g, "*");
function coverage(prefixRe, requests) {
  const spec = readFileSync(resolve(repo, "lib/api-spec/v1-openapi.yaml"), "utf8");
  const specPaths = [...spec.matchAll(prefixRe)].map((m) => canon(m[1]));
  const collectionPaths = new Set(
    requests.map((r) => canon("/" + r.request.url.path.join("/").split("?")[0])),
  );
  const missing = specPaths.filter((p) => !collectionPaths.has(p));
  return { specCount: specPaths.length, missing };
}

// /v1 product API and /cp/v1 control plane are each kept in lockstep with the spec.
const v1 = coverage(/^ {2}(\/v1[^\s:]*):/gm, v1Requests);
const cp = coverage(/^ {2}(\/cp\/v1[^\s:]*):/gm, cpRequests);
const specCount = v1.specCount + cp.specCount;
const missing = [...v1.missing, ...cp.missing];
if (missing.length > 0) {
  console.error(`Postman collection is missing ${missing.length} path(s) from the OpenAPI spec:`);
  for (const m of missing) console.error(`  - ${m}`);
  process.exit(1);
}

if (process.argv.includes("--check")) {
  console.log(`Postman /v1 coverage OK: ${specCount} spec paths all present.`);
  process.exit(0);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(resolve(OUT_DIR, "SignalGrid.postman_collection.json"), JSON.stringify(collection, null, 2) + "\n");
writeFileSync(resolve(OUT_DIR, "SignalGrid.postman_environment.json"), JSON.stringify(environment, null, 2) + "\n");
console.log(`Built Postman collection (${publicFolder.item.length + simFolder.item.length + v1Requests.length + cpRequests.length} requests) + environment. Spec coverage: ${specCount} paths (/v1 + /cp/v1).`);
