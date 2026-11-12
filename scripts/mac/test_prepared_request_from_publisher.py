#!/usr/bin/env python3
"""Fixture bridge: actual publisher markers into the actual tick validator.

Called only by brain-proposal-pr.mjs --self-test. No live DB, job, model, network,
clearance or full tick is invoked. The terminal receipt is synthetic fixture
data; the request and metadata come from the publisher's real prepare function.
"""
import ast
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile

REPO = Path(__file__).resolve().parents[2]
PUBLISHER = REPO / "scripts/mac/brain-proposal-pr.mjs"
TICK_SOURCE = REPO / "scripts/mac/lane-tick.sh"
UID = os.getuid()
OID_RE = re.compile(r"[0-9a-f]{40}")


def main():
    raw = sys.stdin.buffer.read(1048577)
    if len(raw) > 1048576:
        raise ValueError("Fixture input exceeds its bound")
    value = json.loads(raw.decode("utf-8", errors="strict"))
    if set(value) != {"messages", "request"} or not isinstance(value["messages"], list):
        raise ValueError("Exact fixture input required")
    source = TICK_SOURCE.read_text().split("<<'PY_BRAIN_PUBLICATION'\n", 1)[1].split("\nPY_BRAIN_PUBLICATION", 1)[0]
    tree = ast.parse(source)
    names = {"Refusal", "need", "read_file", "read_json", "dependency_refs", "need_source_pins",
             "strict_prepared_json", "prepared_request", "utc"}
    selected = [node for node in tree.body
                if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in names]
    if {node.name for node in selected} != names:
        raise ValueError("Actual tick validator definitions changed")
    dependencies = next(node.value for node in tree.body
                        if isinstance(node, ast.Assign)
                        and any(isinstance(target, ast.Name) and target.id == "DEPENDENCIES"
                                for target in node.targets))
    namespace = dict(globals())
    namespace["DEPENDENCIES"] = ast.literal_eval(dependencies)
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(TICK_SOURCE), "exec"), namespace)
    read_file = namespace["read_file"]

    with tempfile.TemporaryDirectory(prefix="publisher-tick-contract-fixture-") as directory:
        attempt = Path(directory).resolve()
        def save(name, content):
            path = attempt / name
            with path.open("xb") as stream:
                os.chmod(path, 0o400)
                stream.write(content)
            return read_file(path)[1]
        def save_json(name, item):
            return save(name, (json.dumps(item, sort_keys=True) + "\n").encode())
        stdout_ref = save("stdout.raw", ("\n".join(value["messages"]) + "\n").encode())
        stderr_ref = save("stderr.raw", b"")
        intent = {"job_id": value["request"]["job"],
                  "publisher_ref": read_file(PUBLISHER, private=False)[1],
                  "tick_ref": read_file(TICK_SOURCE, private=False)[1],
                  "dependency_refs": namespace["dependency_refs"]()}
        save_json("intent.json", intent)
        save_json("terminal.json", {"returncode": 0, "normal_exit": True,
                  "timed_out": False, "interruptions": [], "original_wait_completed": True,
                  "started_receipt_error": None,
                  "stdout_ref": stdout_ref, "stderr_ref": stderr_ref})
        print(json.dumps({"fixture_loader_ok": True,
                          "actual_export_sources": [row["source"] for row in value["request"]["exports"]]}), flush=True)
        handoff = namespace["prepared_request"](attempt, intent)
        if (handoff["request"] != value["request"] or handoff["privacy_clearance"] is not False
                or handoff["public_egress_allowed"] is not False):
            raise ValueError("Actual handoff changed identity or invented permission")
        print(json.dumps({"fixture_handoff_ok": True, "privacy_clearance": False,
                          "public_egress_allowed": False}))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print("publisher/tick fixture refused: " + type(exc).__name__, file=sys.stderr)
        raise SystemExit(1)
