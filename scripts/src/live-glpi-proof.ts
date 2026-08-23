// proof:live-glpi — the ITSM class, proven without any vendor signup
// (DR-013 item 3; DR-016's loop assigned scripts/ to the gate-and-proof lane).
//
// WHAT THIS IS, AND DELIBERATELY IS NOT.
//
// This is a SHAPE-DISCOVERY proof, not a contract proof, and the distinction is
// the honest part. The GLPI image is verified: `glpi/glpi` exists on Docker Hub
// (HTTP 200) and `11.0.8` is a real published tag — `glpiproject/glpi` is a 404
// and was never used. Its environment contract is taken from the image's own
// published description, not from memory: GLPI_DB_HOST / GLPI_DB_NAME /
// GLPI_DB_USER / GLPI_DB_PASSWORD / GLPI_DB_PORT, a MariaDB backend, port 80
// in-container.
//
// What is NOT verified is the REST surface. GLPI ships a v1 API at
// /apirest.php and a v2 API whose shape differs by edition and release, and
// this repository has never driven either. Asserting a v2 request/response
// contract from memory is exactly what DR-015 rule 6 forbids, and the cost of
// getting it wrong is a proof that passes against a shape the server does not
// have.
//
// So this proof RECORDS what the server actually answers and asserts only what
// it can observe:
//   1. GLPI is reachable and serving.
//   2. Each candidate API root is probed and its real status + body prefix is
//      recorded — /apirest.php (v1) and /api.php (v2 candidate).
//   3. At least one root answers in a way that identifies GLPI, or the proof
//      FAILS LOUDLY with the bodies attached.
//   4. A capture lands at artifacts/live-captures/glpi.json carrying what was
//      observed, with provenance.
//
// The capture is the deliverable. Once a real machine has run this once, the
// v2 contract stops being a guess and the NEXT proof can assert it. That is
// the same order the Headwind lane should have followed: its credential was
// asserted rather than observed, and it turned out `admin/admin` had never
// authenticated on any machine.
//
// FAIL LOUDLY, NEVER PATCH AROUND. If a root answers something unexpected,
// this prints the status and body prefix and exits non-zero so the runner
// records a real failure. Do not add a fallback that makes it green.
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.GLPI_URL ?? "http://127.0.0.1:8430";
const FIXTURE_TIMESTAMP = "2026-08-23T00:00:00.000Z";

type Probe = {
  path: string;
  purpose: string;
  status: number | null;
  contentType: string | null;
  bodyPrefix: string;
  error?: string;
};

const assertions: Array<{ name: string; ok: boolean; detail?: string }> = [];
const assert = (name: string, ok: boolean, detail?: string) => {
  assertions.push({ name, ok, detail });
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

async function probe(path: string, purpose: string): Promise<Probe> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "manual",
    });
    const body = await res.text();
    return {
      path,
      purpose,
      status: res.status,
      contentType: res.headers.get("content-type"),
      bodyPrefix: body.slice(0, 240),
    };
  } catch (error) {
    return {
      path,
      purpose,
      status: null,
      contentType: null,
      bodyPrefix: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

console.log(`proof:live-glpi — shape discovery against ${BASE}\n`);

const root = await probe("/", "does GLPI serve at all");
assert("GLPI is reachable and serving", root.status !== null, root.error ?? `HTTP ${root.status}`);
if (root.status === null) {
  console.error(`\nGLPI unreachable at ${BASE}: ${root.error}`);
  process.exit(1);
}

const identifiesAsGlpi = /glpi/i.test(root.bodyPrefix) || /glpi/i.test(root.contentType ?? "");
assert(
  "the served page identifies as GLPI",
  identifiesAsGlpi,
  identifiesAsGlpi ? undefined : `body began: ${JSON.stringify(root.bodyPrefix.slice(0, 120))}`,
);

const probes: Probe[] = [root];
for (const [path, purpose] of [
  ["/apirest.php", "REST v1 root — the long-standing endpoint"],
  ["/apirest.php/initSession", "REST v1 session init (expected to REFUSE without tokens; the refusal SHAPE is the evidence)"],
  ["/api.php", "REST v2 root candidate — unverified, which is why this is a probe"],
] as const) {
  const p = await probe(path, purpose);
  probes.push(p);
  console.log(`  · ${path} → ${p.status ?? "unreachable"} ${p.contentType ?? ""}`);
}

// An API root that ANSWERS — even with an auth refusal — proves the surface is
// there. A 404 on every candidate means the shape is not what we probed, and
// that is a finding to report, not a thing to work around.
const answering = probes.filter((p) => p.path !== "/" && p.status !== null && p.status !== 404);
assert(
  "at least one REST root answers (an auth refusal counts; a 404 everywhere does not)",
  answering.length > 0,
  answering.length > 0
    ? answering.map((p) => `${p.path}=${p.status}`).join(", ")
    : "every candidate returned 404 or was unreachable — report the real paths by lane mail, do not guess again",
);

const capture = {
  source: "glpi",
  capturedFrom: BASE,
  provenance: {
    proof: "proof:live-glpi",
    kind: "shape-discovery",
    note:
      "Records what the server answered. It does NOT assert a v2 request/response contract, " +
      "because this repository has never driven one and asserting it from memory is forbidden. " +
      "Once this capture exists, the next proof may assert against it.",
    fixtureTimestamp: FIXTURE_TIMESTAMP,
  },
  probes,
};

mkdirSync("artifacts/live-captures", { recursive: true });
writeFileSync("artifacts/live-captures/glpi.json", `${JSON.stringify(capture, null, 2)}\n`);
console.log("\n  capture written: artifacts/live-captures/glpi.json");

const failed = assertions.filter((a) => !a.ok);
console.log(`\nlive-glpi: ${assertions.length - failed.length}/${assertions.length} assertions passed`);
if (failed.length > 0) {
  console.error("\nFailed:");
  for (const f of failed) console.error(`  - ${f.name}${f.detail ? ` (${f.detail})` : ""}`);
  console.error(
    "\nDo not patch around this. Attach the probe bodies from the capture to a lane message so the\n" +
      "real shape is recorded once, rather than guessed twice.",
  );
  process.exit(1);
}
console.log("live-glpi passed — the ITSM class answers, and what it answered is now on disk.");
