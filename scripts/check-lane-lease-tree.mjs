// Preserved actual-filesystem binding controls; no host reservation is acquired.
import { runPythonRegressions as controls } from "./lib/lane-python-regressions.mjs";
controls({ label: "lane-lease-tree", script: "check-lane-lease-tree.py", expectedTests: 5 });
