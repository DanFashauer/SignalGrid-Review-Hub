// Four complete heartbeat wrong-witness cases, including the real generic HOLD.
import { runPythonRegressions } from "./lib/lane-python-regressions.mjs";
runPythonRegressions({ label: "lane-mismatch", script: "check-lane-mismatch.py", expectedTests: 4 });
