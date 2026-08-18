// Which lane am I, and how do I know?
//
// The simulation request loop already carries WORK between lanes. This carries
// the other half — what one lane needs the other to KNOW — because that half was
// still being couriered by the owner, who is phone-first and at the remote office
// a few hours a day. A human retyping messages between two agents is a bus with
// one very expensive hop.
//
// IDENTITY IS DERIVED, NOT DECLARED, with an explicit override. Asking each lane
// to remember to set a variable produces exactly one failure mode: an unset
// variable somewhere, and messages addressed to a lane nobody is reading. macOS
// is the Mac lane by construction — it is the only machine that can run the
// hardware operations, which is the whole reason the two lanes exist. Everything
// else is the cloud lane. `SIGNALGRID_LANE` overrides for the case this rule gets
// wrong (a second Mac, a Linux workstation acting as the local lane).

export const LANES = Object.freeze(["cloud", "mac"]);

/** @returns {"cloud"|"mac"} */
export function currentLane() {
  const declared = process.env.SIGNALGRID_LANE;
  if (declared && LANES.includes(declared)) return declared;
  return process.platform === "darwin" ? "mac" : "cloud";
}

export function otherLane(lane = currentLane()) {
  return lane === "mac" ? "cloud" : "mac";
}
