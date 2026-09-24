# Vendored: apple/device-management (the pinned `declarative/status/` subset only)

Third-party work, copied in unmodified. **Not ours.**

| | |
|---|---|
| Upstream | https://github.com/apple/device-management |
| Author | Apple Inc. |
| Licence | MIT (`LICENSE.txt` in this directory, byte-identical to the upstream root `LICENSE.txt`) |
| Commit | `09f249a06e7e3289930bf6d05f38fb562f748ebf` (tag `Release-v27.0`) |
| Vendored | 2026-09-18 (`device.operating-system.family.yaml` added 2026-09-24, same commit) |
| Contents | 11 files under `declarative/status/` plus `LICENSE.txt` and this note. Exactly the status items the two in-tree alignments pin — `DDM_APPLE_STATUS_ITEMS` in `lib/ddm-connector/src/apple-schema.ts` and `APPLE_DDM_STATUS_ITEMS` in `lib/integrations/src/integrations/macos-posture/apple-schema.ts`. Nothing here is imported at runtime; `proof:ddm-connector` READS these files. |
| Basis | `docs/BUILD_BACKLOG.md` — "Hold the DDM/macOS-posture schema pins against Apple's YAML". Apple accepts schema feedback via Feedback Assistant, not pull requests. |

## Why only this subset

The upstream repository is Apple's whole device-management vocabulary — MDM commands,
profile payloads, declarations, and ~60 status items. This tree pins eleven of those status
items and reads nothing else, so vendoring the rest would republish a large body of
somebody else's work for no check.

The four other status items macOS/iOS 27.0 introduced (`mdm.is-shared-ipad`,
`mdm.is-awaiting-configuration`, `security.lockdown-mode`, `device.system.health`) are
deliberately NOT here: nothing in this tree reads them yet, and a vendored file no proof
resolves is a file that rots unwatched. They are named in
`lib/ddm-connector/src/apple-schema.ts` as known-and-unmodelled.

## What the gate does with it

`proof:ddm-connector` resolves every pinned item in BOTH catalogs to a file in this
directory and asserts the file's `payload.statusitemtype` equals the pinned name and that
the keys the connector reads appear in its `payloadkeys`. A pin with no vendored file, a
vendored file whose `statusitemtype` disagrees, or a re-pin to a schema release nobody
re-vendored, all fail there instead of drifting silently. Before this directory existed
the alignment header promised that a schema change "surfaces as a failing check" while no
proof read Apple's YAML at all.

## Re-vendoring

Clone `apple/device-management` at the tag you are moving to, copy the same file list plus
`LICENSE.txt`, update `DDM_APPLE_SCHEMA_VERSION` / `APPLE_DEVICE_MANAGEMENT_SCHEMA_VERSION`
and `APPLE_SCHEMA_PIN_SHA`, and re-run `pnpm run proof:ddm-connector`. The proof fails
until the vendored files and the pins agree.
