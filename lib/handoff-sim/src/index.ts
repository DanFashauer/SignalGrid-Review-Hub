// @workspace/handoff-sim — Issue #136's deterministic cross-device handoff
// simulation plus the exception-release verification loop. A handoff script is
// DATA (assemble → handoff → exception → resolve → verify → release); the
// simulator replays it through the REAL mechanisms (`assembleWorkContext`,
// `reevaluateForDevice`, the task-exception `normalizeReport →
// evaluateTaskException → fromTaskException` chain, the `resolveException` door)
// and records every outcome — refusals included, by typed code, never by echoed
// ref — in a deep-frozen trace. Release obeys one law: a resolution posting is
// not verification; release requires independent evidence AND a trusted device.
// Fixture simulation only — no live systems, no production workflow.
export * from "./types";
export * from "./release";
export * from "./simulate";
