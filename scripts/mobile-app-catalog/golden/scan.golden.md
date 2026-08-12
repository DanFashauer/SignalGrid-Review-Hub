# SignalGrid mobile-app repository scan

- Scanner: `2.0.0`
- Findings: **6**

| Path | Type | Identifiers | Config keys | Secret-shaped keys | Errors |
|---|---|---|---:|---:|---|
| `evil/app-escape-link.json` | symlink_refused |  | 0 | 0 | SymlinkRefused: symlinks are never followed |
| `evil/appconfig-doctype-refused.xml` | appconfig_definition |  | 0 | 0 | ValueError: DOCTYPE/external entity declarations are refused |
| `evil/oversized-app-notes.md` | documentation |  | 0 | 0 | SizeCapExceeded: 11261 bytes > cap 8192; content not read |
| `good/AndroidManifest.xml` | android_build_manifest | com.signalgrid.fixture.android, com.signalgrid.fixture.android.HostApp, schemas.android.com | 2 | 0 |  |
| `good/Info.plist` | ios_build_metadata | com.signalgrid.fixture | 3 | 1 |  |
| `good/app.config.json` | json_manifest_or_config | com.signalgrid.fixture | 5 | 1 |  |
