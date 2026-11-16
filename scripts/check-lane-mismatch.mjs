// Four complete heartbeat wrong-witness cases, including the real generic HOLD.
import { runPythonRegressions as controls } from "./lib/lane-python-regressions.mjs";
controls({ label: "lane-mismatch", script: "check-lane-mismatch.py", expectedTests: 4 });
