// Preserved push controls + strict-refusal UNIT scope; generic HOLD is recorded.
import { runPythonRegressions } from "./lib/lane-python-regressions.mjs";
runPythonRegressions({ label: "lane-push", script: "check-lane-push.py", expectedTests: 31 });
