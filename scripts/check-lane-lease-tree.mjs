// Preserved actual-filesystem binding controls; no host reservation is acquired.
import { runPythonRegressions } from "./lib/lane-python-regressions.mjs";
runPythonRegressions({ label: "lane-lease-tree", script: "check-lane-lease-tree.py", expectedTests: 5 });
