// The auto-stall kinds scripts/raised-hands.mjs detects, with each kind's soft limit in hours.
// A leaf module (imports nothing) so the hand schema, the hand writer and the gate share ONE list
// without importing each other.
/** Soft limit per source: past it the hand is on the list; past 3x it the gate fails unless covered. */
export const SOFT_LIMIT_H = { mail: 24, sim: 48, heartbeat: null /* the routine's own cadenceToleranceHours */, "pr-red": 24, "pr-idle": 48, "executor-gap": 48, "objective-owner": 48, "mac-lane-red": 1 };
export const AUTO_KINDS = Object.keys(SOFT_LIMIT_H);
