// Types for `launch-profile.mjs`.
//
// The profile is plain ESM so `check-launch-profile.mjs` — itself plain ESM, like
// every other gate in scripts/ — can import it with no build step. That leaves the
// TypeScript proof unable to type the import, so the shape is declared here rather
// than the proof being loosened to `any`. A scope file whose own structure is
// unchecked would be an odd thing for this repository to ship.

export type LaunchStatus = "launch" | "deferred" | "demo_only" | "internal";

/** A classified item. `reason` is required for launch / demo_only / internal — the
 *  gate and the proof both enforce that, because those three are arguable decisions
 *  and an unargued one is just an assertion. */
export interface ProfileEntry {
  id: string;
  reason: string;
  /** Work this entry needs that does not exist yet. Mirrored into `GAPS`. */
  gap?: string;
}

/** `deferred` entries are bare ids: they share `DEFERRED_RATIONALE`, so repeating one
 *  sentence 134 times would be volume rather than rigor. */
export interface ProfileSurface {
  key: string;
  /** How the gate re-derives this surface's real membership from source. */
  derivedFrom: string;
  launch: ProfileEntry[];
  demo_only: ProfileEntry[];
  internal: ProfileEntry[];
  deferred: string[];
}

/**
 * One mechanical condition that, if met, means the gap has been closed. Read against
 * comment-stripped source so prose describing the work cannot close a gap.
 */
export type GapClosureCondition =
  | { file: string; contains: string }
  | { file: string; absent: string }
  | { dir: string; anyFileContainsAll: string[] };

export interface ProfileGap {
  id: string;
  surface: string;
  whatIsMissing: string;
  /**
   * REQUIRED. What would make this gap closed, checkable by
   * `check-launch-profile.mjs` — which fails the build when every condition holds.
   * Without it a gap is a claim about the code that nothing ever re-reads, and two
   * of these outlived their own fixes for exactly that reason.
   */
  closedWhen: GapClosureCondition[];
}

export const LAUNCH_PROFILE_VERSION: number;
export const PRODUCT_NAME: string;
export const TARGET: string;
export const CRITERION: string;
export const DEFERRED_RATIONALE: string;
export const SURFACES: ProfileSurface[];
export const GAPS: ProfileGap[];
export const STATUSES: LaunchStatus[];
