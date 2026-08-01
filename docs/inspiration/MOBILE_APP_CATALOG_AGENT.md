# Mobile-app catalog agent — UNHARDENED reference source (intake row 33)

<!--
  PROVENANCE / BOUNDARY PREAMBLE — added at filing time (intake ledger row 33).

  This file preserves, VERBATIM, two companion artifacts of the owner-compiled
  Mobile App & Managed Configuration Master Catalog (2026-08-01): the
  repository-scanner agent source and the catalog JSON Schema. They are filed
  as REFERENCE ONLY — nothing in this repository executes this source, and the
  scanner is NOT registered with any gate, proof, or CI job in this tree.

  The actual integration is a QUEUED YELLOW-LANE BUILD (docs/BUILD_BACKLOG.md,
  "Mobile-app-catalog scanner phase"), because the adversarial intake audit
  VERIFIED, by execution against this exact source, defects that must be fixed
  before any run whose output is committed or published:

  1. SECRET LEAK: `BUNDLE_RE` copies dotted-token secrets (e.g. a JWT stored
     under a non-secret-shaped key) verbatim into `identifiers` in both the
     JSON and markdown outputs — so the emitted
     `publicSafety.valuesRedacted: true` is an OVERCLAIM as written. It is
     preserved here unmodified as evidence of the delta the hardening phase
     must document; do not treat that flag as true.
  2. FILE-SYMLINK ESCAPE: a symlink inside the scanned tree pointing outside
     the root is followed, and its content is hashed and scanned into the
     report; directory-symlink glob semantics additionally differ between
     Python 3.12 and 3.13.
  3. NON-DETERMINISM: `generatedAt` (wall clock) plus absolute
     `repository_root`/`roots` paths make output churn per run and per
     machine, breaking the repo's git-diff re-derivability idiom.
  4. Unescaped `|` in markdown table cells; unbounded `read_bytes` on matched
     files (no size cap).

  What IS sound, verified: DOCTYPE/external-entity XML refusal; no network
  calls; no UEM/vendor mutation; stdlib-only.

  The owner-referenced scheduled PR-creating GitHub Actions workflow was NOT
  uploaded and is deliberately NOT authored: it would be this repository's
  first autonomous contents-write surface, contrary to the no-blind-auto-merge
  rule (docs/LEVEL_10_AUTOPILOT_RUNBOOK.md) and the adaptive-proposals
  a-proposal-cannot-activate-itself doctrine. It may exist only as its own
  explicitly owner-approved future phase.

  Original upload SHA-256 (for the hardening delta):
    scanner  7228277496c465e49da60e4aa16c40899da5ab25418a39c87964d43b036b977a
    schema   7f067cffde429bd46f1e61b5add79e6df725ee37304388985935de40619f7d85
    workbook f8f1cd431d447be8635fbcb361c3b5d7e9aba85786d7b215f0a6347829322451

  No dependency is taken on any vendor named in these artifacts, and
  "official Intune protected partner app" is Microsoft's catalog term — it
  never means a SignalGrid partnership.
-->

## Scanner source (verbatim, unhardened)

```python
#!/usr/bin/env python3
"""SignalGrid mobile-app catalog repository scanner.

Safe by default:
- Standard-library only.
- No network calls.
- Reads repository files and emits public-safe metadata.
- Redacts secret-shaped values.
- Rejects XML with DOCTYPE/external entities.
- Does not deploy apps, mutate UEM state, or activate production policy.

External vendor/store/document adapters should produce reviewed source observations;
this scanner is the repository-discovery and evidence component.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import plistlib
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

VERSION = "1.0.0"

SECRET_RE = re.compile(
    r"(secret|password|passwd|token|api[_-]?key|private[_-]?key|certificate|"
    r"tenant[_-]?id|client[_-]?secret|access[_-]?key)",
    re.IGNORECASE,
)
BUNDLE_RE = re.compile(r"\b(?:[A-Za-z][A-Za-z0-9_-]*\.){2,}[A-Za-z0-9_-]+\b")
CONFIG_KEY_RE = re.compile(
    r'["\']([A-Z][A-Z0-9_]{3,}|com\.[A-Za-z0-9_.-]+|'
    r'[a-z][A-Za-z0-9_.-]{3,})["\']\s*[:=]'
)
MANAGED_READ_RE = re.compile(
    r'(?:environment|objectForKey|dictionaryForKey|valueForKey|'
    r'standardUserDefaults|RestrictionsManager)[^\n]{0,160}'
    r'["\']([A-Za-z0-9_.-]{3,})["\']'
)

SCAN_NAMES = {
    "Info.plist", "AndroidManifest.xml", "restrictions.xml", "app_restrictions.xml",
    "project.yml", "project.yaml", "app.config.json", "app.json", "manifest.json",
    "Package.swift",
}
SCAN_SUFFIXES = {
    ".plist", ".mobileconfig", ".entitlements", ".xml", ".json", ".yaml", ".yml",
    ".swift", ".kt", ".java", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".md",
}
SKIP_DIRS = {
    ".git", "node_modules", ".build", "build", "dist", "DerivedData", ".next",
    ".venv", "venv", "__pycache__", "Pods", ".expo", "coverage",
}

@dataclass
class Finding:
    repository_root: str
    path: str
    artifact_type: str
    identifiers: list[str] = field(default_factory=list)
    config_keys: list[str] = field(default_factory=list)
    secret_shaped_keys: list[str] = field(default_factory=list)
    source_hash: str = ""
    parser: str = ""
    errors: list[str] = field(default_factory=list)

def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()

def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def redact(value: Any, key: str = "") -> Any:
    if SECRET_RE.search(key):
        return "<REDACTED>"
    if isinstance(value, dict):
        return {str(k): redact(v, str(k)) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v, key) for v in value]
    if isinstance(value, str) and SECRET_RE.search(value[:120]):
        return "<REDACTED>"
    return value

def classify(path: Path) -> str:
    name = path.name.lower()
    if name == "info.plist":
        return "ios_build_metadata"
    if path.suffix.lower() == ".mobileconfig":
        return "apple_configuration_profile"
    if path.suffix.lower() == ".entitlements":
        return "ios_entitlements"
    if name == "androidmanifest.xml":
        return "android_build_manifest"
    if name in {"restrictions.xml", "app_restrictions.xml"}:
        return "android_managed_configuration_schema"
    if "appconfig" in name and path.suffix.lower() == ".xml":
        return "appconfig_definition"
    if path.suffix.lower() == ".plist":
        return "plist_or_managed_app_config"
    if path.suffix.lower() in {".yaml", ".yml"}:
        return "yaml_project_or_policy"
    if path.suffix.lower() == ".json":
        return "json_manifest_or_config"
    if path.suffix.lower() in {".swift", ".kt", ".java"}:
        return "native_source"
    if path.suffix.lower() in {".ts", ".tsx", ".js", ".mjs", ".cjs"}:
        return "application_source"
    if path.suffix.lower() == ".md":
        return "documentation"
    return "other"

def parse_xml(data: bytes) -> tuple[list[str], list[str]]:
    text = data.decode("utf-8", errors="replace")
    upper = text.upper()
    if "<!DOCTYPE" in upper or "<!ENTITY" in upper:
        raise ValueError("DOCTYPE/external entity declarations are refused")
    root = ET.fromstring(text)
    identifiers: set[str] = set(BUNDLE_RE.findall(text))
    keys: set[str] = set()
    for elem in root.iter():
        tag = elem.tag.split("}")[-1]
        for attr_name, attr_value in elem.attrib.items():
            value = attr_value or ""
            if attr_name.lower().endswith(("key", "name")) and value:
                keys.add(value)
            identifiers.update(BUNDLE_RE.findall(value))
        if tag in {"key", "restriction"} and elem.text:
            keys.add(elem.text.strip())
    return sorted(identifiers), sorted(k for k in keys if k)

def parse_plist(data: bytes) -> tuple[list[str], list[str], list[str]]:
    obj = plistlib.loads(data)
    keys: set[str] = set()
    secret_keys: set[str] = set()
    identifiers: set[str] = set()
    def walk(value: Any) -> None:
        if isinstance(value, dict):
            for key, child in value.items():
                key_text = str(key)
                keys.add(key_text)
                if SECRET_RE.search(key_text):
                    secret_keys.add(key_text)
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)
        elif isinstance(value, str):
            identifiers.update(BUNDLE_RE.findall(value))
    walk(obj)
    return sorted(identifiers), sorted(keys), sorted(secret_keys)

def scan_file(root: Path, path: Path) -> Finding:
    data = path.read_bytes()
    text = data.decode("utf-8", errors="replace")
    finding = Finding(
        repository_root=str(root),
        path=str(path.relative_to(root)),
        artifact_type=classify(path),
        source_hash=sha256(data),
    )
    try:
        if path.suffix.lower() in {".plist", ".mobileconfig", ".entitlements"}:
            ids, keys, secret_keys = parse_plist(data)
            finding.identifiers = ids
            finding.config_keys = keys
            finding.secret_shaped_keys = secret_keys
            finding.parser = "plistlib"
        elif path.suffix.lower() == ".xml" or path.name == "AndroidManifest.xml":
            ids, keys = parse_xml(data)
            finding.identifiers = ids
            finding.config_keys = keys
            finding.secret_shaped_keys = sorted(k for k in keys if SECRET_RE.search(k))
            finding.parser = "ElementTree-safe"
        elif path.suffix.lower() == ".json":
            obj = json.loads(text)
            serialized = json.dumps(redact(obj), sort_keys=True)
            finding.identifiers = sorted(set(BUNDLE_RE.findall(serialized)))
            finding.config_keys = sorted(set(CONFIG_KEY_RE.findall(serialized)))
            finding.secret_shaped_keys = sorted(
                key for key in finding.config_keys if SECRET_RE.search(key)
            )
            finding.parser = "json"
        else:
            finding.identifiers = sorted(set(BUNDLE_RE.findall(text)))
            keys = set(CONFIG_KEY_RE.findall(text))
            keys.update(MANAGED_READ_RE.findall(text))
            finding.config_keys = sorted(keys)
            finding.secret_shaped_keys = sorted(k for k in keys if SECRET_RE.search(k))
            finding.parser = "regex-safe"
    except Exception as exc:
        finding.errors.append(f"{type(exc).__name__}: {exc}")
    return finding

def candidate(path: Path) -> bool:
    if path.name in SCAN_NAMES:
        return True
    if path.suffix.lower() not in SCAN_SUFFIXES:
        return False
    lower = str(path).lower()
    return any(term in lower for term in (
        "app", "mobile", "ios", "android", "manifest", "config", "policy",
        "workflow", "bundle", "package", "enterprise", "provider", "launcher",
        "kiosk", "host",
    ))

def scan_roots(roots: list[Path]) -> dict[str, Any]:
    findings: list[Finding] = []
    for root in roots:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if any(part in SKIP_DIRS for part in path.parts):
                continue
            if candidate(path):
                findings.append(scan_file(root, path))
    findings.sort(key=lambda x: (x.repository_root, x.path))
    return {
        "schemaVersion": 1,
        "scannerVersion": VERSION,
        "generatedAt": utcnow(),
        "roots": [str(r) for r in roots],
        "findingCount": len(findings),
        "findings": [asdict(f) for f in findings],
        "publicSafety": {
            "networkCalls": False,
            "valuesRedacted": True,
            "xmlDoctypeRejected": True,
            "mutatesProductionPolicy": False,
        },
    }

def write_markdown(report: dict[str, Any], path: Path) -> None:
    lines = [
        "# SignalGrid mobile-app repository scan",
        "",
        f"- Generated: `{report['generatedAt']}`",
        f"- Scanner: `{report['scannerVersion']}`",
        f"- Findings: **{report['findingCount']}**",
        "",
        "| Path | Type | Identifiers | Config keys | Secret-shaped keys | Errors |",
        "|---|---|---|---:|---:|---|",
    ]
    for item in report["findings"]:
        ids = ", ".join(item["identifiers"][:4])
        errors = "; ".join(item["errors"])
        lines.append(
            f"| `{item['path']}` | {item['artifact_type']} | {ids} | "
            f"{len(item['config_keys'])} | {len(item['secret_shaped_keys'])} | {errors} |"
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("roots", nargs="*", default=["."], help="Repository roots")
    parser.add_argument("--json-out", default="artifacts/mobile-app-catalog/repo-scan.json")
    parser.add_argument("--md-out", default="docs/generated/MOBILE_APP_CATALOG_SCAN.md")
    args = parser.parse_args()

    report = scan_roots([Path(root).resolve() for root in args.roots])
    json_path = Path(args.json_out)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    write_markdown(report, Path(args.md_out))
    print(json.dumps({
        "scannerVersion": VERSION,
        "findingCount": report["findingCount"],
        "jsonOut": str(json_path),
        "markdownOut": args.md_out,
    }))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
```

## Catalog JSON Schema (verbatim)

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://signalgrid.example/schemas/mobile-app-catalog.schema.json",
  "title": "SignalGrid Mobile App Catalog",
  "type": "object",
  "required": [
    "catalogVersion",
    "generatedAt",
    "apps",
    "sources"
  ],
  "properties": {
    "catalogVersion": {
      "type": "string"
    },
    "generatedAt": {
      "type": "string",
      "format": "date-time"
    },
    "apps": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "appId",
          "canonicalName",
          "vendor",
          "recordClass",
          "industry",
          "status"
        ],
        "properties": {
          "appId": {
            "type": "string",
            "pattern": "^[a-z0-9][a-z0-9._-]+$"
          },
          "canonicalName": {
            "type": "string",
            "minLength": 1
          },
          "vendor": {
            "type": "string",
            "minLength": 1
          },
          "recordClass": {
            "enum": [
              "confirmed_mobile_app",
              "protected_partner_app",
              "industry_candidate",
              "candidate_ecosystem_surface",
              "repo_workflow_model",
              "signalgrid_surface"
            ]
          },
          "industry": {
            "type": "string"
          },
          "workflowUseCase": {
            "type": "string"
          },
          "personas": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "uniqueItems": true
          },
          "platforms": {
            "type": "array",
            "items": {
              "enum": [
                "ios",
                "ipados",
                "android",
                "visionos",
                "web",
                "pwa",
                "macos",
                "windows",
                "rugged",
                "embedded"
              ]
            }
          },
          "identifiers": {
            "type": "array",
            "items": {
              "type": "object",
              "required": [
                "platform",
                "identifier",
                "sourceUrl",
                "observedAt"
              ],
              "properties": {
                "platform": {
                  "type": "string"
                },
                "identifier": {
                  "type": "string"
                },
                "storeUrl": {
                  "type": "string",
                  "format": "uri"
                },
                "sourceUrl": {
                  "type": "string",
                  "format": "uri"
                },
                "observedVersion": {
                  "type": "string"
                },
                "observedAt": {
                  "type": "string",
                  "format": "date-time"
                }
              },
              "additionalProperties": false
            }
          },
          "managedConfiguration": {
            "type": "object",
            "properties": {
              "supported": {
                "enum": [
                  "confirmed",
                  "possible",
                  "unknown",
                  "not_supported"
                ]
              },
              "channels": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "schemas": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "sourceUrls": {
                "type": "array",
                "items": {
                  "type": "string",
                  "format": "uri"
                }
              }
            },
            "additionalProperties": false
          },
          "signalGrid": {
            "type": "object",
            "properties": {
              "workflowKeys": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "signalInputs": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "actionRisk": {
                "type": "string"
              },
              "priority": {
                "enum": [
                  "P0",
                  "P1",
                  "P2",
                  "P3",
                  "P4"
                ]
              }
            },
            "additionalProperties": false
          },
          "status": {
            "enum": [
              "confirmed",
              "candidate",
              "research_gap",
              "deprecated",
              "retired"
            ]
          },
          "notes": {
            "type": "string"
          }
        },
        "additionalProperties": false
      }
    },
    "sources": {
      "type": "array",
      "items": {
        "type": "object",
        "required": [
          "sourceUrl",
          "sourceType",
          "retrievedAt",
          "contentHash",
          "confidence"
        ],
        "properties": {
          "sourceUrl": {
            "type": "string",
            "format": "uri"
          },
          "sourceType": {
            "type": "string"
          },
          "retrievedAt": {
            "type": "string",
            "format": "date-time"
          },
          "contentHash": {
            "type": "string"
          },
          "etag": {
            "type": "string"
          },
          "parser": {
            "type": "string"
          },
          "confidence": {
            "enum": [
              "primary",
              "official_catalog",
              "community",
              "repository",
              "candidate"
            ]
          },
          "redistributionBoundary": {
            "type": "string"
          }
        },
        "additionalProperties": false
      }
    }
  },
  "additionalProperties": false
}```
