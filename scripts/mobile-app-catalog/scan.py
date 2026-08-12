#!/usr/bin/env python3
"""SignalGrid mobile-app catalog repository scanner — HARDENED build (v2).

Lineage: docs/inspiration/MOBILE_APP_CATALOG_AGENT.md preserves the owner's
original v1.0.0 source verbatim (SHA-256
7228277496c465e49da60e4aa16c40899da5ab25418a39c87964d43b036b977a). The intake
audit (ledger row 33) VERIFIED, by execution, five defects in that source; this
build exists to fix exactly those, and each fix is marked `HARDENED:` where it
lives so the delta stays reviewable against the filed original:

  1. HARDENED(credential-shape): BUNDLE_RE also matches dotted secrets (a JWT
     under a non-secret-shaped key), which v1 copied verbatim into
     `identifiers` while stamping `valuesRedacted: true` — an overclaim. Every
     identifier now passes a credential-shape filter before it is emitted.
  2. HARDENED(symlink): v1 followed file symlinks (hashing content from
     OUTSIDE the scanned root into the report) and directory-symlink glob
     semantics differ across Python versions. Symlinks are now never followed:
     candidate file symlinks are recorded as refused with no content read, and
     traversal uses os.walk(followlinks=False) plus explicit pruning.
  3. HARDENED(determinism): v1 stamped wall-clock `generatedAt` and absolute
     `repository_root`/`roots`, so two runs were never byte-identical. Output
     now carries no clock unless the caller supplies one, and every path is
     emitted relative, posix-style, exactly as the root was named on argv.
  4. HARDENED(markdown): table cells are escaped; a `|` in a path or an error
     message can no longer break the table.
  5. HARDENED(read-cap): per-file reads are bounded; an oversized file is
     recorded loudly with no content read instead of being slurped whole.

Unchanged because the audit verified them sound: stdlib-only, no network
calls, DOCTYPE/external-entity XML refusal, no UEM/vendor mutation.

A missing scan root is an ERROR (exit 2), never an empty success — an empty
report over a mistyped path is a measurement never taken.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import plistlib
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

VERSION = "2.0.0"

# MINIMUM INTERPRETER, checked rather than assumed.
#
# This scanner runs wherever the harness runs, and on macOS `python3` is very
# often Xcode's 3.9.x rather than a Homebrew build — the owner's Mac is exactly
# that. Nothing here uses 3.10+ syntax (no match statements, and
# `from __future__ import annotations` makes every hint a lazy string), so 3.9
# is genuinely enough. The guard exists for the version BELOW that: without it a
# 3.8 interpreter fails somewhere inside plistlib or a dict-ordering assumption
# with a message nobody can act on, in the middle of a long harness run.
if sys.version_info < (3, 9):
    print(
        f"scan.py needs Python 3.9 or newer; this interpreter is "
        f"{sys.version_info.major}.{sys.version_info.minor}. "
        "Install a newer python3 (brew install python@3.12) or point the harness at one.",
        file=sys.stderr,
    )
    raise SystemExit(2)

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

# HARDENED(credential-shape): a legitimate bundle/package identifier is short
# reverse-DNS — every real one has modest segments. A JWT or dotted secret has
# long base64ish segments. The bounds are deliberately generous for real ids
# (com.enterprise.shell, androidx.core.content.FileProvider) and reject every
# credential shape the audit reproduced. Deterministic, no entropy heuristics.
MAX_IDENTIFIER_LEN = 100
MAX_SEGMENT_LEN = 32
MAX_SEGMENTS = 10


def credential_shaped(value: str) -> bool:
    """True when a BUNDLE_RE match looks like a credential, not an identifier."""
    if len(value) > MAX_IDENTIFIER_LEN:
        return True
    segments = value.split(".")
    if len(segments) > MAX_SEGMENTS:
        return True
    return any(len(seg) > MAX_SEGMENT_LEN for seg in segments)


def safe_identifiers(candidates: Any) -> list[str]:
    """Sorted, deduplicated identifiers with every credential shape removed."""
    return sorted({c for c in candidates if not credential_shaped(c)})


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

DEFAULT_MAX_FILE_BYTES = 1_048_576


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
    return safe_identifiers(identifiers), sorted(k for k in keys if k)


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
    return safe_identifiers(identifiers), sorted(keys), sorted(secret_keys)


def scan_file(root_label: str, root: Path, path: Path, max_file_bytes: int) -> Finding:
    finding = Finding(
        repository_root=root_label,
        # HARDENED(determinism): relative, posix-style, machine-independent.
        path=path.relative_to(root).as_posix(),
        artifact_type=classify(path),
    )

    # HARDENED(symlink): never follow. Recorded loudly rather than skipped
    # silently, so the report carries evidence of the refusal.
    if path.is_symlink():
        finding.artifact_type = "symlink_refused"
        finding.errors.append("SymlinkRefused: symlinks are never followed")
        return finding

    # HARDENED(read-cap): stat before read; an oversized file is recorded with
    # no content read at all — no hash, no identifiers, a loud error.
    size = path.stat().st_size
    if size > max_file_bytes:
        finding.errors.append(
            f"SizeCapExceeded: {size} bytes > cap {max_file_bytes}; content not read"
        )
        return finding

    data = path.read_bytes()
    text = data.decode("utf-8", errors="replace")
    finding.source_hash = sha256(data)
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
            finding.identifiers = safe_identifiers(BUNDLE_RE.findall(serialized))
            finding.config_keys = sorted(set(CONFIG_KEY_RE.findall(serialized)))
            finding.secret_shaped_keys = sorted(
                key for key in finding.config_keys if SECRET_RE.search(key)
            )
            finding.parser = "json"
        else:
            finding.identifiers = safe_identifiers(BUNDLE_RE.findall(text))
            keys = set(CONFIG_KEY_RE.findall(text))
            keys.update(MANAGED_READ_RE.findall(text))
            finding.config_keys = sorted(keys)
            finding.secret_shaped_keys = sorted(k for k in keys if SECRET_RE.search(k))
            finding.parser = "regex-safe"
    except Exception as exc:  # noqa: BLE001 — every parse failure lands in the report
        finding.errors.append(f"{type(exc).__name__}: {exc}")
    return finding


def candidate(path_text: str, name: str, suffix: str) -> bool:
    if name in SCAN_NAMES:
        return True
    if suffix not in SCAN_SUFFIXES:
        return False
    lower = path_text.lower()
    return any(term in lower for term in (
        "app", "mobile", "ios", "android", "manifest", "config", "policy",
        "workflow", "bundle", "package", "enterprise", "provider", "launcher",
        "kiosk", "host",
    ))


def scan_roots(root_args: list[str], max_file_bytes: int) -> dict[str, Any]:
    findings: list[Finding] = []
    for root_arg in root_args:
        root = Path(root_arg)
        if not root.exists():
            # HARDENED: a missing root is an error, not an empty success.
            raise FileNotFoundError(f"scan root does not exist: {root_arg}")
        root_label = Path(root_arg).as_posix()
        # HARDENED(symlink): os.walk with followlinks=False guarantees directory
        # symlinks are never traversed, on every Python version — rglob's
        # directory-symlink semantics differ between 3.12 and 3.13, which is
        # exactly the kind of version-dependent behaviour a deterministic
        # scanner cannot stand on. Symlinked dirs are ALSO pruned explicitly.
        for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
            dirnames[:] = sorted(
                d for d in dirnames
                if d not in SKIP_DIRS and not (Path(dirpath) / d).is_symlink()
            )
            for filename in sorted(filenames):
                path = Path(dirpath) / filename
                rel_text = path.relative_to(root).as_posix()
                if candidate(rel_text, path.name, path.suffix.lower()):
                    findings.append(scan_file(root_label, root, path, max_file_bytes))
    findings.sort(key=lambda x: (x.repository_root, x.path))
    return {
        "schemaVersion": 2,
        "scannerVersion": VERSION,
        # HARDENED(determinism): no generatedAt unless the caller supplies one
        # (see main); no absolute paths anywhere.
        "roots": [Path(r).as_posix() for r in root_args],
        "findingCount": len(findings),
        "findings": [asdict(f) for f in findings],
        "publicSafety": {
            "networkCalls": False,
            "valuesRedacted": True,
            "identifiersCredentialFiltered": True,
            "xmlDoctypeRejected": True,
            "symlinksFollowed": False,
            "deterministicOutput": True,
            "mutatesProductionPolicy": False,
        },
    }


def md_escape(cell: str) -> str:
    """HARDENED(markdown): a cell value can no longer break the table."""
    return cell.replace("\\", "\\\\").replace("|", "\\|").replace("`", "\\`").replace("\n", " ")


def write_markdown(report: dict[str, Any], path: Path) -> None:
    lines = [
        "# SignalGrid mobile-app repository scan",
        "",
        f"- Scanner: `{report['scannerVersion']}`",
        f"- Findings: **{report['findingCount']}**",
    ]
    if "generatedAt" in report:
        lines.insert(2, f"- Generated: `{md_escape(report['generatedAt'])}`")
    lines += [
        "",
        "| Path | Type | Identifiers | Config keys | Secret-shaped keys | Errors |",
        "|---|---|---|---:|---:|---|",
    ]
    for item in report["findings"]:
        ids = md_escape(", ".join(item["identifiers"][:4]))
        errors = md_escape("; ".join(item["errors"]))
        lines.append(
            f"| `{md_escape(item['path'])}` | {md_escape(item['artifact_type'])} | {ids} | "
            f"{len(item['config_keys'])} | {len(item['secret_shaped_keys'])} | {errors} |"
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def selftest() -> int:
    """In-process checks of every hardening seam. Exit 0 healthy, 1 broken."""
    fake_jwt = (
        "eyJhbGciOiJub25lIiwidHlwIjoiSldUIiwia2lkIjoiZml4dHVyZSJ9."
        "eyJzdWIiOiJmaXh0dXJlLW9ubHkiLCJhdWQiOiJuZXZlci1yZWFsIn0."
        "Zml4dHVyZS1zaWduYXR1cmUtbm90LXJlYWw"
    )
    checks: list[tuple[str, bool]] = [
        ("a JWT is credential-shaped", credential_shaped(fake_jwt)),
        ("a real bundle id is NOT credential-shaped", not credential_shaped("com.enterprise.shell")),
        ("a deep androidx class id survives", not credential_shaped("androidx.core.content.FileProvider")),
        ("safe_identifiers drops the JWT, keeps the id",
         safe_identifiers([fake_jwt, "com.enterprise.shell"]) == ["com.enterprise.shell"]),
        ("md_escape neutralizes pipe/backtick/newline",
         md_escape("a|b`c\nd") == "a\\|b\\`c d"),
        ("redact hides a secret-shaped key", redact({"api_key": "x"})["api_key"] == "<REDACTED>"),
    ]
    doctype_refused = False
    try:
        parse_xml(b'<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x "y">]><r/>')
    except ValueError:
        doctype_refused = True
    checks.append(("DOCTYPE xml is refused", doctype_refused))
    failed = [name for name, ok in checks if not ok]
    for name, ok in checks:
        print(f"  {'ok' if ok else 'FAIL'} — selftest: {name}")
    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("roots", nargs="*", default=["."], help="Repository roots")
    parser.add_argument("--json-out", default="artifacts/mobile-app-catalog/repo-scan.json")
    parser.add_argument("--md-out", default="docs/generated/MOBILE_APP_CATALOG_SCAN.md")
    parser.add_argument("--max-file-bytes", type=int, default=DEFAULT_MAX_FILE_BYTES)
    parser.add_argument(
        "--generated-at",
        default=None,
        help="Optional ISO-8601 instant to stamp. HARDENED(determinism): the "
        "scanner never reads a clock itself; omit for byte-identical reruns.",
    )
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()

    if args.selftest:
        return selftest()

    try:
        report = scan_roots(args.roots, args.max_file_bytes)
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    if args.generated_at is not None:
        report["generatedAt"] = args.generated_at

    json_path = Path(args.json_out)
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    write_markdown(report, Path(args.md_out))
    print(json.dumps({
        "scannerVersion": VERSION,
        "findingCount": report["findingCount"],
        "jsonOut": Path(args.json_out).as_posix(),
        "markdownOut": Path(args.md_out).as_posix(),
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
