# Headwind CE live shape-check — the fixture verified against a real server

**Status: COMPLETED live, 2026-08-18 (cloud lane, ephemeral in-sandbox lab).**
The `HeadwindLabDevice` fixture shape in `lib/integration-bridge/src/evidence.ts`
was checked field-by-field against device JSON produced by a **real Headwind MDM
Community Edition server (5.30.3-os, `headwindmdm/hmdm:0.1.5`)** — driven over
the **genuine launcher wire protocol**, not the admin panel. This is the same
verification the Fleet lab performed for the Fleet fixtures: the shape either
matches what a real server emits, or the doc says where it diverges.

**This does not change the breadth freeze.** Headwind remains a fixture shape,
not a connector family; no transport was added to the tree. This document
records what a real server says so the fixture's claims stop being untested.

## The lab (all values ephemeral, in-container, never committed)

- `postgres:16` (`hmdm-pg`) + `headwindmdm/hmdm:0.1.5` (`hmdm`) on a private
  Docker network, panel on `localhost:8425`, `PROTOCOL=http`,
  `secure.enrollment=0` (CE default).
- **Sandbox wrinkle:** the image downloads its war (`hmdm-5.30.3-os.war`) from
  `h-mdm.com` at boot; in-container `wget` cannot verify the sandbox's
  TLS-intercepting proxy CA, so the download silently produced a 0-byte
  `ROOT.war` and Tomcat failed with `zip file is empty`. Fix: fetch the war on
  the host (which trusts the proxy CA) and `docker cp` it into both
  `/usr/local/tomcat/work/cache/` and `webapps/ROOT.war`, then restart. The
  `https-openssl-nio-8443` connector failure (`hmdm.jks` missing) is benign
  under `PROTOCOL=http`.

## An upstream CE bug found on the way (worth knowing before any real pilot)

A freshly-initialized CE seeds configuration 1 with `password: null`, and the
5.30.3 device-sync handler (`SyncResource.getDeviceSetting`) MD5-hashes the
configuration's admin password **unconditionally** — so the very first device
sync against a stock CE install throws `NullPointerException` in
`CryptoUtil.getMD5String` and the launcher receives
`{"status":"ERROR","message":"error.internal.server"}`. Setting any admin
password on the configuration clears it. Anyone standing up CE for a real
evaluation will hit this before the first device enrolls.

## What was driven, in order (the launcher's own endpoints)

1. Panel API: create device `hw-scanner-01` on configuration 1
   (`PUT /rest/private/devices`).
2. **Device side** `GET /rest/public/sync/configuration/hw-scanner-01` — the
   launcher's configuration pull; answered `OK` with the full launcher config
   (kiosk exit flag, MQTT push options, config password hash).
3. **Device side** `POST /rest/public/sync/info` — the launcher's telemetry
   push (`model`, `androidVersion`, `batteryLevel`, `kioskMode`, `mdmMode`,
   `launcherPackage`, `defaultLauncher`). Wire note: `phone` and `imei` are
   **strings** in this build, not arrays — an array is rejected at
   deserialization.
4. Panel API: re-read the device record and capture both states.

## The two server-side states observed (verbatim structure, synthetic values)

**Before any device sync** — created in the panel, never heard from:

```json
{ "number": "hw-scanner-01", "statusCode": "red",
  "configurationId": 1, "lastUpdate": 0 }
```

No `info`, no `enrollTime`, `lastUpdate` literally `0`. This is exactly the
fixture's *unenrolled spare* state (`hw-spare-03`: `enrolled: false`,
`configApplied: "unknown"`, `lastSeenAt: null`).

**After one genuine sync cycle:**

```json
{ "number": "hw-scanner-01", "statusCode": "green",
  "info": { "deviceId": "hw-scanner-01", "model": "Zebra TC52",
            "kioskMode": true, "mdmMode": true, "androidVersion": "13",
            "batteryLevel": 85, "defaultLauncher": true },
  "configurationId": 1, "kioskMode": true, "mdmMode": true,
  "lastUpdate": 1787086989856, "enrollTime": 1787086989856,
  "publicIp": "172.19.0.1" }
```

This is the fixture's *healthy kiosk scanner* state (`hw-scanner-01`:
`enrolled: true`, `kioskLocked: true`, `configApplied: "applied"`).

## Field-by-field: fixture ↔ real server

| `HeadwindLabDevice` field | Real server field | Verdict |
| --- | --- | --- |
| `deviceNumber` | `number` (top-level, the enrollment identity) | ✅ exists as modeled |
| `model` | `info.model` — **nested** in the launcher-reported `info` blob, not top-level | ✅ exists; a real adapter must read it from `info` |
| `enrolled` | derivable: `enrollTime` present / `lastUpdate > 0`; absent both before first sync | ✅ both states observed live |
| `kioskLocked` | `kioskMode` (mirrored top-level and in `info`) | ✅ exists — but note it is **launcher-reported**, not server-verified; the positive-assertion law in `headwindLabToDeviceManagementEvidence` is the right posture |
| `configApplied` | `statusCode` (`"red"` → `"green"` observed) — a **derived tri-state+** combining config match and freshness | ⚠️ simplification: Headwind also documents `yellow` (config mismatch), **not observed in this run**; red conflates "config failed" with "not seen lately" |
| `lastSeenAt` | `lastUpdate` — **epoch milliseconds**, `0` meaning never | ✅ exists; adapter must convert epoch-ms→ISO and map `0`→`null` |

**Net verdict: the fixture shape is honest.** Every field corresponds to a real
server field or a one-step derivation; the two divergences (nesting of `model`,
epoch-ms `lastUpdate`) are wire-format details a future adapter normalizes, and
the one semantic simplification (`configApplied` vs the derived `statusCode`)
is now recorded rather than assumed.

## What was NOT verified (stated, not smoothed)

- **`yellow` statusCode** (config mismatch) — documented by Headwind, not
  produced in this run.
- **QR provisioning and a real Android launcher** — the wire protocol was
  driven by hand (which is what proves the shape); no Android device or
  emulator was enrolled.
- **MQTT push** (`pushOptions: "mqttWorker"`, port 31000) — configured by the
  server, not exercised.
- Nothing here ran against Headwind's **Enterprise** edition.

## Reproduction

The lab is ephemeral and intentionally uncommitted. To re-run: start
`postgres:16` and `headwindmdm/hmdm:0.1.5` on one network (`SQL_HOST`,
`PROTOCOL=http`), work around the war download if behind an intercepting
proxy (above), log into the panel (`admin` / MD5-uppercased default), **set a
configuration password first** (the NPE above), create a device, then drive
`GET /rest/public/sync/configuration/{number}` and
`POST /rest/public/sync/info` and read back
`POST /rest/private/devices/search`.
