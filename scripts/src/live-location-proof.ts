// Proof: the location-services connector against a REAL Traccar server.
//
// Traccar is Apache-2.0, self-hosted, no account and no trial clock, and it is
// what ZERO_COST_LIVE_TEST_MATRIX section 8 nominates for this dimension. Unlike
// the Fleet lane, this connector has NO hardcoded vendor paths — it takes an
// injectable transport — so there are no wrong URLs to find. The question a live
// server answers here is the other one, the one fixtures cannot: what does a real
// platform actually put on the wire, and what happens at the seam where a vendor's
// vocabulary is translated into ours?
//
// WHAT TRACCAR SUPPLIES (measured on 6.14.5, via its real OsmAnd ingest protocol
// and REST API — every position below was ingested over the wire, not fabricated):
//   deviceId       ← position.deviceId
//   capturedAt     ← position.fixTime
//   accuracyMeters ← position.accuracy
//   latitude/longitude
//   geofence membership ← position.geofenceIds
//
// THE FINDING, and the reason this lane was worth running:
//
//   `geofenceIds: null` is AMBIGUOUS. It means BOTH "this fix is outside every
//   geofence" AND "this device has no geofences linked at all", and the two are
//   indistinguishable in the response.
//
// Measured, not reasoned: the SAME coordinates (37.4220, -122.0841) return
// `geofenceIds: [1]` while a geofence is linked to the device and `null` after
// that link is removed — the device never moved. This proof reproduces that
// experiment against the live server every time it runs.
//
// Why it matters more than it sounds: the obvious mapping, `null → "outside"`,
// makes a device sitting at the exact centre of headquarters report as
// off-premises the moment somebody unlinks a geofence — a configuration change
// silently becomes a location signal. `evaluateLocation` faithfully turns
// `outside` into an off-premises posture, so the fabrication would enter the
// fabric wearing a real verdict's clothes.
//
// The honest mapping needs a SECOND fact the position response does not carry:
// whether the device has any geofence to be outside OF. That is asserted here, so
// anyone writing a Traccar adapter inherits the disambiguation rather than the
// trap. The connector itself is already fail-safe — normalizeGeofence sends
// anything it does not recognise to `unknown`, and `unknown` yields
// NO_LOCATION/monitor rather than a claim — and that is pinned too.
//
// Refuses loudly without a server, like proof:live-edr and proof:live-fleet.
//
//   see docs/TRACCAR_LIVE_INTEGRATION.md for the bring-up
//   TRACCAR_URL=http://127.0.0.1:8482 TRACCAR_USER=... TRACCAR_PASS=... \
//     pnpm run proof:live-location

import {
  normalizeFix,
  evaluateLocation,
  type LocationFixRaw,
} from "@workspace/integrations/location-services";

const BASE = process.env.TRACCAR_URL?.replace(/\/$/, "");
const USER = process.env.TRACCAR_USER ?? "";
const PASS = process.env.TRACCAR_PASS ?? "";

if (!BASE || !USER || !PASS) {
  console.error(
    "proof:live-location REFUSED — needs TRACCAR_URL, TRACCAR_USER and TRACCAR_PASS.\n" +
      "This proof exists to read a REAL Traccar server; without one there is nothing it\n" +
      "could honestly report. See docs/TRACCAR_LIVE_INTEGRATION.md to bring one up.\n",
  );
  process.exit(1);
}

const TRACCAR: string = BASE;
const AUTH = `Basic ${Buffer.from(`${USER}:${PASS}`).toString("base64")}`;

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

interface TraccarPosition {
  deviceId: number;
  fixTime: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  geofenceIds: number[] | null;
}

async function api<T>(path: string, init?: RequestInit): Promise<{ status: number; json: T | null }> {
  const res = await fetch(`${TRACCAR}${path}`, {
    ...init,
    headers: { Authorization: AUTH, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let json: T | null = null;
  try {
    json = text ? (JSON.parse(text) as T) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

/** Ingest a position through Traccar's REAL OsmAnd protocol (port 5055). */
async function ingest(uniqueId: string, lat: number, lon: number, accuracy: number, tsSec: number): Promise<number> {
  const ingestUrl = process.env.TRACCAR_INGEST_URL ?? TRACCAR.replace(/:\d+$/, ":5055");
  const res = await fetch(
    `${ingestUrl}/?id=${encodeURIComponent(uniqueId)}&lat=${lat}&lon=${lon}&timestamp=${tsSec}&accuracy=${accuracy}&speed=0`,
  );
  return res.status;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The mapping a Traccar adapter must use.
 *
 * `geofenceIds` alone cannot answer "is this device off-premises". `null` covers
 * both "outside all geofences" and "no geofences linked", so the second fact —
 * does this device have any geofence at all — has to come from elsewhere
 * (/api/geofences?deviceId=N). Without it the only honest answer is `unknown`.
 */
function toLocationFix(p: TraccarPosition, deviceHasGeofences: boolean): LocationFixRaw {
  const ids = p.geofenceIds;
  const geofenceState = !deviceHasGeofences
    ? undefined //  → normalizes to "unknown": nothing to be outside of
    : ids && ids.length > 0
      ? "inside"
      : "outside";
  return {
    deviceId: String(p.deviceId),
    capturedAt: p.fixTime,
    source: "gps",
    accuracyMeters: p.accuracy,
    geofenceState,
    geofenceId: ids && ids.length > 0 ? String(ids[0]) : undefined,
  };
}

async function main(): Promise<void> {
  const UNIQUE = process.env.TRACCAR_DEVICE ?? "SG-PROOF-PHONE";
  const CENTRE = { lat: 37.422, lon: -122.0841 };
  const AWAY = { lat: 37.47, lon: -122.14 };

  // ── 1. A real, authenticated session ──────────────────────────────────────
  const server = await api<{ version: string }>("/api/server");
  check("reached a live Traccar server", server.status === 200, `status=${server.status}`);
  console.log(`  (Traccar ${server.json?.version ?? "?"})`);

  // ── 2. Provision a device + geofence through the real API ─────────────────
  const devices = await api<{ id: number; uniqueId: string }[]>("/api/devices");
  let device = devices.json?.find((d) => d.uniqueId === UNIQUE);
  if (!device) {
    const created = await api<{ id: number; uniqueId: string }>("/api/devices", {
      method: "POST",
      body: JSON.stringify({ name: "SG Proof Phone", uniqueId: UNIQUE }),
    });
    device = created.json ?? undefined;
  }
  check("a real device exists in Traccar", !!device?.id);
  if (!device) throw new Error("cannot continue without a device");

  // Remove every pre-existing geofence first. This proof is re-runnable against a
  // long-lived local server, and a geofence still linked from an earlier run (or a
  // run that died between link and unlink) would keep `geofenceIds` non-null and
  // quietly destroy the very ambiguity this proof exists to demonstrate. A proof
  // whose subject can be erased by leftover state is not measuring what it claims.
  const existing = await api<{ id: number }[]>("/api/geofences");
  for (const g of existing.json ?? []) {
    await api(`/api/geofences/${g.id}`, { method: "DELETE" });
  }

  const geo = await api<{ id: number }>("/api/geofences", {
    method: "POST",
    body: JSON.stringify({ name: "SG Proof Campus", area: `CIRCLE (${CENTRE.lat} ${CENTRE.lon}, 500)` }),
  });
  const geofenceId = geo.json?.id;
  check("a real geofence exists in Traccar", typeof geofenceId === "number");

  const link = await api("/api/permissions", {
    method: "POST",
    body: JSON.stringify({ deviceId: device.id, geofenceId }),
  });
  check("the geofence is linked to the device", link.status === 204 || link.status === 200, `status=${link.status}`);

  // ── 3. THE EXPERIMENT — same coordinates, two different answers ───────────
  // Ingested over Traccar's real protocol, then read back through its REST API.
  const t0 = Math.floor(Date.now() / 1000);
  check("a fix INSIDE the geofence is accepted by the live ingest protocol",
    (await ingest(UNIQUE, CENTRE.lat, CENTRE.lon, 8, t0)) === 200);
  await sleep(2500);
  check("a fix OUTSIDE the geofence is accepted", (await ingest(UNIQUE, AWAY.lat, AWAY.lon, 25, t0 + 3)) === 200);
  await sleep(2500);

  // Now REMOVE the geofence link and re-send the ORIGINAL inside coordinates.
  const unlink = await api("/api/permissions", {
    method: "DELETE",
    body: JSON.stringify({ deviceId: device.id, geofenceId }),
  });
  check("the geofence link is removed (device now has none)", unlink.status === 204, `status=${unlink.status}`);
  check("the SAME centre coordinates are re-ingested after unlinking",
    (await ingest(UNIQUE, CENTRE.lat, CENTRE.lon, 8, t0 + 6)) === 200);
  await sleep(2500);

  // Poll rather than sleep-and-hope: ingestion is asynchronous, and a fixed wait
  // either flakes on a slow server or wastes time on a fast one. This is the same
  // reason the proof re-reads through the REST API at all — the wire is the
  // authority, not our expectation of it.
  // Window the query to THIS run's first fix, not "the last hour". Against a
  // long-lived server, `slice(-3)` over an hour of history silently mixes in
  // positions from a previous run — which is exactly how this proof first went
  // green standalone and red inside the suite. Anchor on t0 so the three positions
  // can only be the three this run ingested.
  let positions: TraccarPosition[] = [];
  const from = new Date((t0 - 1) * 1000).toISOString();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const to = new Date(Date.now() + 60_000).toISOString();
    const hist = await api<TraccarPosition[]>(`/api/positions?deviceId=${device.id}&from=${from}&to=${to}`);
    positions = hist.json ?? [];
    if (positions.length === 3) break;
    await sleep(1000);
  }
  check("read three real positions back from the REST API", positions.length === 3, `count=${positions.length}`);
  if (positions.length !== 3) throw new Error("cannot continue without the three positions");

  const [insideLinked, outsideLinked, insideUnlinked] = positions;
  check("fix 1 (inside, geofence linked) reports membership", (insideLinked.geofenceIds ?? []).length > 0,
    JSON.stringify(insideLinked.geofenceIds));
  check("fix 2 (outside, geofence linked) reports geofenceIds null", insideLinked.geofenceIds !== null && outsideLinked.geofenceIds === null,
    JSON.stringify(outsideLinked.geofenceIds));
  check("fix 3 (SAME coordinates as fix 1, geofence unlinked) ALSO reports null", insideUnlinked.geofenceIds === null,
    JSON.stringify(insideUnlinked.geofenceIds));
  check("…so identical coordinates yield different geofenceIds purely from configuration — `null` is AMBIGUOUS",
    insideLinked.latitude === insideUnlinked.latitude &&
      insideLinked.longitude === insideUnlinked.longitude &&
      JSON.stringify(insideLinked.geofenceIds) !== JSON.stringify(insideUnlinked.geofenceIds));

  // ── 4. The naive mapping would fabricate an off-premises signal ───────────
  // Stated as an assertion rather than a comment so the trap is demonstrated,
  // not merely described: mapping null→outside makes a stationary device at HQ
  // centre read as off-premises.
  const naive = normalizeFix(
    { deviceId: String(device.id), capturedAt: insideUnlinked.fixTime, source: "gps",
      accuracyMeters: insideUnlinked.accuracy, geofenceState: "outside" },
    new Date().toISOString(),
  );
  const naiveVerdict = evaluateLocation(naive, Date.now());
  check("naive null→outside mapping WOULD report a device at HQ centre as off-premises",
    naiveVerdict.posture !== "on_premises" && naive.geofenceState === "outside",
    `posture=${naiveVerdict.posture} reason=${naiveVerdict.reasonCode}`);

  // ── 5. The honest mapping, through the REAL connector ─────────────────────
  const honest = normalizeFix(toLocationFix(insideUnlinked, /* deviceHasGeofences */ false), new Date().toISOString());
  check("honest mapping sends an unlinked device to `unknown`, not `outside`", honest.geofenceState === "unknown",
    honest.geofenceState);
  const honestVerdict = evaluateLocation(honest, Date.now());
  check("…and the connector answers NO_LOCATION / monitor — a question, not a claim",
    honestVerdict.reasonCode === "NO_LOCATION" && honestVerdict.recommendedAction === "monitor",
    `${honestVerdict.reasonCode}/${honestVerdict.recommendedAction}`);
  check("…and it never asserts the device is on premises", honestVerdict.posture !== "on_premises", honestVerdict.posture);

  // ── 6. With a geofence genuinely linked, real membership drives the verdict ─
  const insideSignal = normalizeFix(toLocationFix(insideLinked, true), new Date().toISOString());
  check("a linked, inside fix normalizes to `inside`", insideSignal.geofenceState === "inside");
  const insideVerdict = evaluateLocation(insideSignal, Date.parse(insideLinked.fixTime) + 1000);
  check("…and a FRESH inside fix is graded on premises", insideVerdict.posture === "on_premises",
    `${insideVerdict.posture}/${insideVerdict.reasonCode}`);

  const outsideSignal = normalizeFix(toLocationFix(outsideLinked, true), new Date().toISOString());
  check("a linked, outside fix normalizes to `outside`", outsideSignal.geofenceState === "outside");

  // ── 7. Freshness comes from the REAL fix time ─────────────────────────────
  // Graded far in the future: a real timestamp from the server, aged past the
  // staleness window, must stop being treated as current position.
  const staleVerdict = evaluateLocation(insideSignal, Date.parse(insideLinked.fixTime) + 48 * 3_600_000);
  check("a real fix aged past the stale window is no longer trusted as current",
    staleVerdict.reasonCode === "STALE_LOCATION_FIX" && staleVerdict.recommendedAction === "locate",
    `${staleVerdict.reasonCode}/${staleVerdict.recommendedAction}`);

  // ── 8. Precise coordinates are flagged for the privacy policy ─────────────
  const precise = normalizeFix(
    { deviceId: String(device.id), capturedAt: insideLinked.fixTime, source: "gps",
      geofenceState: "inside", latitude: insideLinked.latitude, longitude: insideLinked.longitude },
    new Date().toISOString(),
  );
  check("real coordinates set hasPreciseCoordinates so precise use stays auditable",
    precise.hasPreciseCoordinates === true && evaluateLocation(precise, Date.now()).usesPreciseLocation === true);

  console.log(
    `\n  measured: Traccar supplied ${["deviceId", "capturedAt", "accuracyMeters", "latitude", "longitude"].length}` +
      " of LocationFixRaw's fields; geofence membership needed a second call to disambiguate",
  );

  const total = passed + failures.length;
  console.log(`\nsummary=${failures.length === 0 ? "pass" : "FAIL"} (${passed}/${total})`);
  if (failures.length > 0) {
    console.error("failed:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("location-services verified against a live Traccar: an ambiguous null never becomes a location claim.");
}

main().catch((err) => {
  console.error(`proof:live-location crashed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
