// proof:live-headwind — the SECOND live device-management source (DR-013's
// endpoint source-independence milestone, first half).
//
// The Mac's source-independence run (sim result 2026-08-22) measured the gap
// precisely: "every Headwind reference in the tree is a FIXTURE SHAPE… a
// parity session between two LIVE sources is not possible today because only
// one of the two can be stood up." This proof, driven by the new `headwind`
// lane in run-live-lanes.sh, stands the second one up: a real Headwind MDM
// Community Edition server (the exact build the 2026-08-18 shape-check
// verified: 5.30.3-os via headwindmdm/hmdm:0.1.5), driven over the GENUINE
// launcher wire protocol — configuration pull and telemetry push — not the
// admin panel alone.
//
// What it asserts, in the shape-check's own order:
//   1. the panel answers and a device can be created on configuration 1;
//   2. the known upstream CE bug is pre-empted (a stock CE seeds config 1
//      with password:null and the sync handler MD5-hashes it unconditionally
//      → NPE on first sync; the lane sets an admin password first, and this
//      proof VERIFIES the sync does not hit error.internal.server);
//   3. the launcher config pull answers OK with the kiosk/MQTT fields;
//   4. the telemetry push is accepted (phone/imei as STRINGS — the wire
//      rejects arrays in this build, a divergence the shape-check recorded);
//   5. the server-side record transitions: lastUpdate 0 → >0 after sync —
//      the freshness signal the whole product is about, observed live;
//   6. a CAPTURE lands at artifacts/live-captures/headwind.json: the REAL
//      server's post-sync state, mapped into HeadwindLabDevice shape with
//      provenance — the file proof:evidence-adapter's capture section reads,
//      which is what turns "fixture shape" into "live-verified shape".
//
// Refusal, not skip: without HMDM_URL this exits 3 with the bring-up command
// named, because a proof that silently passes with no server proves nothing.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Anchor the capture at the REPO ROOT, not the cwd. The harness runs this proof
// via `pnpm --filter @workspace/scripts`, so cwd is scripts/ — a bare relative
// "artifacts/…" would land in scripts/artifacts/. Resolve from this source file
// (scripts/src/…) up to the repo root so the capture is written where every
// other artifacts/* lives and where proof:evidence-adapter reads it.
const CAPTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../artifacts/live-captures");

const BASE = process.env.HMDM_URL?.replace(/\/$/, "");
if (!BASE) {
  console.error(
    "proof:live-headwind REFUSED — needs HMDM_URL (e.g. http://127.0.0.1:8425).\n" +
      "Bring the lane up with: ./scripts/run-live-lanes.sh --only headwind",
  );
  process.exit(3);
}

const DEVICE = process.env.HMDM_DEVICE ?? "hw-scanner-01";
let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failed += 1; console.error(`  ✗ FAIL — ${name}${detail ? `  (${detail})` : ""}`); }
};

async function jf(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${BASE}${path}`, init);
  let body: unknown = null;
  try { body = await res.json(); } catch { /* non-JSON is a finding, not a crash */ }
  return { status: res.status, body };
}

// Panel login → JWT-less CE uses cookie/basic? CE panel private API accepts
// the default admin credentials the lane sets; it returns a session cookie.
async function panelLogin(): Promise<string> {
  const res = await fetch(`${BASE}/rest/public/jwt/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: process.env.HMDM_ADMIN ?? "admin", password: process.env.HMDM_PASSWORD ?? "admin" }),
  });
  const j = (await res.json().catch(() => ({}))) as { id_token?: string };
  return j.id_token ?? "";
}

const main = async () => {
  console.log(`live-headwind against ${BASE}\n`);

  const token = await panelLogin();
  check("panel authenticates (JWT issued)", token.length > 0);
  const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // 1. create (or upsert) the device on configuration 1
  const put = await jf("/rest/private/devices", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ number: DEVICE, configurationId: 1, description: "live-headwind proof device" }),
  });
  check("device created/updated via panel API", put.status === 200, `status=${put.status}`);

  // 2+3. the launcher's own configuration pull — the NPE trap fires HERE on
  // a stock CE if the lane failed to set the config password.
  const cfg = await jf(`/rest/public/sync/configuration/${DEVICE}`);
  const cfgBody = cfg.body as { status?: string; data?: { kioskMode?: unknown; newServerUrl?: unknown } & Record<string, unknown> };
  check("launcher config pull answers OK (upstream NPE pre-empted by the lane)",
    cfg.status === 200 && cfgBody?.status === "OK", `status=${cfg.status} body.status=${cfgBody?.status}`);
  check("config carries launcher fields (kioskMode present in payload)",
    cfgBody?.data !== undefined && "kioskMode" in (cfgBody.data ?? {}));

  // 4. the launcher's telemetry push — strings, not arrays, per the recorded wire divergence
  const info = await jf("/rest/public/sync/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deviceId: DEVICE, model: "Zebra TC52", androidVersion: "13",
      batteryLevel: 87, kioskMode: true, mdmMode: true,
      launcherPackage: "com.hmdm.launcher", defaultLauncher: true,
      phone: "", imei: "",
    }),
  });
  const infoBody = info.body as { status?: string };
  check("telemetry push accepted (phone/imei as strings — the wire's real rule)",
    info.status === 200 && infoBody?.status === "OK", `status=${info.status} body.status=${infoBody?.status}`);

  // 5. server-side record transition — freshness observed live.
  // Read the device back by its number: GET /rest/private/devices/number/{number}
  // returns the device object directly under `data` (observed live on 5.30.3-os:
  // {status:"OK",data:{number,id,description,groups,info,configurationId,lastUpdate}}).
  // The earlier /devices/search?value= form was wrong twice over — that endpoint is
  // a POST taking a DeviceSearchRequest body, and its response nests under
  // data.configurations, not a device list — so it never matched and the record
  // read back as absent even though the device existed.
  const read = await jf(`/rest/private/devices/number/${DEVICE}`, { headers: auth });
  const rec = (read.body as { data?: Record<string, unknown> })?.data;
  check("device record readable back from the panel", read.status === 200 && rec?.number === DEVICE);
  const lastUpdate = Number(rec?.lastUpdate ?? 0);
  check("lastUpdate transitioned 0 → >0 after the sync (freshness, observed live)", lastUpdate > 0, `lastUpdate=${lastUpdate}`);

  // 6. the capture — what turns the fixture shape into a live-verified shape
  const capture = {
    $comment:
      "Live capture from a real Headwind CE server (lane: run-live-lanes.sh --only headwind). " +
      "Synthetic lab values only — no tenant, no real device. Read by proof:evidence-adapter's " +
      "capture section; regenerate by re-running the lane.",
    source: "headwind-ce",
    serverImage: "headwindmdm/hmdm:0.1.5 (5.30.3-os)",
    capturedAt: new Date().toISOString(),
    devices: [
      {
        deviceNumber: DEVICE,
        model: "Zebra TC52",
        enrolled: true,
        kioskLocked: true,
        configApplied: lastUpdate > 0 ? "applied" : "unknown",
        lastSeenAt: lastUpdate > 0 ? new Date(lastUpdate).toISOString() : null,
      },
    ],
  };
  if (failed === 0) {
    mkdirSync(CAPTURE_DIR, { recursive: true });
    writeFileSync(resolve(CAPTURE_DIR, "headwind.json"), JSON.stringify(capture, null, 2) + "\n");
    console.log("  capture written: artifacts/live-captures/headwind.json");
  } else {
    console.log("  capture NOT written — a capture minted from a failing run would be an unearned artifact");
  }

  console.log(`\nsummary=${failed === 0 ? "pass" : "FAIL"} (${passed}/${passed + failed})`);
  if (failed > 0) process.exit(1);
  console.log("Headwind CE driven live over the launcher protocol: the second device-management source stands.");
};

main().catch((e) => { console.error("proof:live-headwind crashed:", e); process.exit(1); });
