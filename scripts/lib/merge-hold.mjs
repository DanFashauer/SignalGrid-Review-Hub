// THE SHARED MERGE HOLD. One branch, lane/merge-hold, records whether mainline is
// frozen. Its tip commit's subject starts with HOLD (frozen) or RELEASE (open); a
// hold is released by pushing a RELEASE commit on top, never by deleting the ref,
// so the branch history is the audit log of every window. SIGNALGRID_MERGE_HOLD=1
// holds locally. Fail-closed: a ref that cannot be read, or a subject that is
// neither word, counts as HELD. Only a readable, absent ref or a RELEASE tip opens it.
export const MERGE_HOLD_REF = "refs/heads/lane/merge-hold";
export function mergeHoldState({ env, lsRemote, subjectOf }) {
  if (env.SIGNALGRID_MERGE_HOLD === "1") return { held: true, why: "SIGNALGRID_MERGE_HOLD=1 in this environment" };
  if (lsRemote.code !== 0) return { held: true, why: `${MERGE_HOLD_REF} could not be read (git ls-remote exit ${lsRemote.code}); unknown counts as held` };
  const sha = lsRemote.out.trim().split(/\s+/)[0] || "";
  if (!sha) return { held: false, why: `no ${MERGE_HOLD_REF} on origin` };
  if (!/^[0-9a-f]{40}$/.test(sha)) return { held: true, why: `${MERGE_HOLD_REF} answered an unreadable sha; unknown counts as held` };
  const subject = subjectOf(sha);
  if (subject === null) return { held: true, why: `${MERGE_HOLD_REF} @ ${sha} could not be fetched; unknown counts as held` };
  if (/^RELEASE\b/.test(subject)) return { held: false, why: `${MERGE_HOLD_REF} @ ${sha.slice(0, 8)} is released: ${subject}` };
  if (/^HOLD\b/.test(subject)) return { held: true, why: `${MERGE_HOLD_REF} @ ${sha.slice(0, 8)} holds mainline: ${subject}` };
  return { held: true, why: `${MERGE_HOLD_REF} @ ${sha.slice(0, 8)} tip is neither HOLD nor RELEASE (${JSON.stringify(subject)}); counts as held` };
}
