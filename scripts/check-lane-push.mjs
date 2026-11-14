// Preserved push controls + strict-refusal UNIT scope; generic HOLD is recorded.
import { runPythonRegressions as controls } from "./lib/lane-python-regressions.mjs";
controls({ label: "lane-push", script: "check-lane-push.py", expectedTests: 31 });
