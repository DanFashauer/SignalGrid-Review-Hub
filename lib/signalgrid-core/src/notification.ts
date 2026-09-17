// Cascade join 3 — the people affected are told through a channel they ALREADY use.
//
// A decision that restricts a shared device, a room or a workflow has consequences
// for people who were never part of it: the next nurse on that cart, the engineer
// holding the other badge, the operator who owns the area. Nothing in this fabric
// told any of them. `pnpm run check:absence "affected user notification"` returned
// CORROBORATED across all four probes on 2026-09-12.
//
// ── THE CONSTRAINT THAT SHAPES THIS, AND WHY IT IS NOT A LIMITATION ──────────
// `docs/PURPOSE.md` §3 and golden rule 3: SignalGrid is invisible to end users and
// MAY NOT ADD A SURFACE THE WORKER HAS TO GO AND READ. So there is no SignalGrid
// notification app, no SignalGrid inbox, and there never will be — those are the
// obvious designs and both are forbidden.
//
// What is left is the right answer anyway: derive WHO is affected, decide WHICH
// channel each of them is already reachable on, and hand that to the host app or
// the organization's own communications system to deliver. This module emits a
// routing instruction. It sends nothing, and it cannot: there is no transport here,
// by design rather than by omission.
//
// ── FAIL-CLOSED, IN THE TWO PLACES IT ACTUALLY MATTERS ───────────────────────
//
//  1. AN AUDIENCE THAT CANNOT BE RESOLVED ROUTES TO THE NAMED OWNER, NEVER TO
//     NOBODY. An empty roster, a holder with no reachable channel, a scope nobody
//     matched — every one of them produces a notice addressed to the owner. The one
//     outcome this module will not produce is silence, because "nobody needed to
//     know" and "we could not work out who needed to know" look identical
//     afterwards and are opposite facts.
//
//  2. SILENCE IS NEVER REPORTED AS TOLD. `NoticeDelivery` is a union whose
//     `delivered` arm REQUIRES the host's own identifier and the instant it
//     reported — a notice cannot be marked delivered by default, by omission, or by
//     a caller that simply stopped looking. Every notice is born `undelivered` with
//     a reason, and only evidence moves it.
//
// ── DETERMINISTIC ────────────────────────────────────────────────────────────
// The audience is derived from evidence the caller already holds, never from a
// live directory query inside a decision path. No clock, no randomness, no IO. The
// same decision and the same roster derive the same notices, in the same order,
// with the same ids, forever.

import { deterministicId } from "./util";
import type { ResolutionAudience, ResolutionChannel } from "./types";

/** What binds a person to the blast radius of a decision. */
export type AffectedScopeKind = "device" | "workflow" | "area";

/**
 * One person the CALLER already knows about, and how they are ALREADY reachable.
 *
 * `channel` is nullable on purpose. "I know this person is affected and I do not
 * know how to reach them" is a real and common state, and it is the state most
 * likely to be quietly dropped — so it is representable, and it routes to the
 * owner rather than disappearing.
 */
export interface ScopeHolder {
  readonly principalRef: string;
  readonly role: ResolutionAudience;
  readonly scope: AffectedScopeKind;
  readonly scopeRef: string;
  /** A channel the organization ALREADY uses for this person. Null = unknown. */
  readonly channel: ResolutionChannel | null;
}

/** The scope a decision actually touched, taken from the decision itself. */
export interface AffectedScope {
  readonly decisionId: string;
  readonly tenantId: string;
  readonly deviceId: string;
  readonly workflowId: string;
  /** The area/room/equipment the grant was scoped to, when the caller knows it. */
  readonly areaRef?: string | null;
  /** The person the decision was ABOUT. Excluded from the audience — they are being
   *  handled by the decision itself, not notified about someone else's. */
  readonly subjectRef: string;
}

/** Why a notice exists, carried so the host can word it for its own users. */
export type NoticeReason = "scope_restricted" | "scope_device_affected" | "scope_workflow_affected" | "audience_unresolved";

export type NoticeDelivery =
  | { readonly state: "undelivered"; readonly reason: string }
  | {
      readonly state: "delivered";
      /** Which host system reported the delivery. Required — a notice cannot become
       *  delivered without naming who delivered it. */
      readonly byHost: string;
      /** The instant the HOST reported, supplied by the caller. No clock here. */
      readonly at: string;
    };

export interface AffectedNotice {
  readonly id: string;
  readonly decisionId: string;
  readonly tenantId: string;
  readonly principalRef: string;
  readonly role: ResolutionAudience;
  readonly channel: ResolutionChannel;
  readonly scope: AffectedScopeKind;
  readonly scopeRef: string;
  readonly reason: NoticeReason;
  /** True when this notice exists because the audience could not be resolved, so a
   *  reader can tell a real audience from the owner backstop at a glance. */
  readonly backstop: boolean;
  readonly delivery: NoticeDelivery;
}

const BORN_UNDELIVERED = "not yet handed to a delivery channel — SignalGrid ships no transport";

/**
 * Who else is inside the affected scope. Pure and total.
 *
 * A holder is affected when the scope they are bound to matches the decision's own:
 * the same device, the same workflow, or the same area. The subject is excluded.
 * Duplicates by principal are collapsed, keeping the first — a person is told once,
 * not once per scope they happen to share.
 */
export function deriveAffectedAudience(scope: AffectedScope, holders: readonly ScopeHolder[]): ScopeHolder[] {
  const matches = (h: ScopeHolder): boolean => {
    if (h.principalRef === scope.subjectRef) return false;
    if (h.scope === "device") return h.scopeRef === scope.deviceId;
    if (h.scope === "workflow") return h.scopeRef === scope.workflowId;
    // "area" is only in scope when the caller actually supplied one. An absent area
    // matches NOTHING rather than everything — the widest possible audience is
    // exactly the wrong failure for a notification path.
    return Boolean(scope.areaRef) && h.scopeRef === scope.areaRef;
  };
  const seen = new Set<string>();
  return holders.filter((h) => {
    if (!matches(h)) return false;
    if (seen.has(h.principalRef)) return false;
    seen.add(h.principalRef);
    return true;
  });
}

const REASON_BY_SCOPE: Record<AffectedScopeKind, NoticeReason> = {
  device: "scope_device_affected",
  workflow: "scope_workflow_affected",
  area: "scope_restricted",
};

/**
 * Turn an affected audience into routing instructions. Pure and total.
 *
 * `ownerRef` is REQUIRED, not optional, because it is the backstop the whole
 * fail-closed property rests on: an optional owner would be omitted at exactly the
 * call site where the audience turned out to be empty, and the guarantee would
 * evaporate at the one moment it was needed.
 */
export function routeAffectedNotices(
  scope: AffectedScope,
  audience: readonly ScopeHolder[],
  ownerRef: string,
): AffectedNotice[] {
  const owned = (reason: NoticeReason, backstop: boolean, principalRef: string, scopeRef: string): AffectedNotice => ({
    id: deterministicId("notice", scope.decisionId, principalRef),
    decisionId: scope.decisionId,
    tenantId: scope.tenantId,
    principalRef,
    role: "operator",
    channel: "notify_owner",
    scope: "device",
    scopeRef,
    reason,
    backstop,
    delivery: { state: "undelivered", reason: BORN_UNDELIVERED },
  });

  // Nobody resolved. This is the case the module exists for: the owner is told that
  // the audience could not be worked out, which is a different and more actionable
  // fact than a decision nobody was told about.
  if (audience.length === 0) {
    return [owned("audience_unresolved", true, ownerRef, scope.deviceId)];
  }

  return audience.map((h) =>
    h.channel === null
      ? // Affected, but unreachable. Routed to the owner, and marked a backstop so it
        // is never mistaken for having reached the person themselves.
        owned("audience_unresolved", true, ownerRef, h.scopeRef)
      : {
          id: deterministicId("notice", scope.decisionId, h.principalRef),
          decisionId: scope.decisionId,
          tenantId: scope.tenantId,
          principalRef: h.principalRef,
          role: h.role,
          channel: h.channel,
          scope: h.scope,
          scopeRef: h.scopeRef,
          reason: REASON_BY_SCOPE[h.scope],
          backstop: false,
          delivery: { state: "undelivered", reason: BORN_UNDELIVERED },
        },
  );
}

/**
 * Record that a HOST delivered a notice. The only way a notice becomes `delivered`.
 *
 * Both arguments are required and neither has a default. A convenience overload
 * that filled in "now" or an anonymous host would reintroduce exactly the lie this
 * union exists to prevent — a notice that claims it reached someone on the strength
 * of nobody having said otherwise.
 */
export function recordNoticeDelivered(notice: AffectedNotice, byHost: string, at: string): AffectedNotice {
  const host = byHost.trim();
  const instant = at.trim();
  if (host === "" || instant === "") {
    return {
      ...notice,
      delivery: {
        state: "undelivered",
        reason: `delivery claimed without ${host === "" ? "a host" : "an instant"} — refused, so silence is not recorded as told`,
      },
    };
  }
  return { ...notice, delivery: { state: "delivered", byHost: host, at: instant } };
}

/** How many of these notices actually reached anyone. Counts `delivered` only —
 *  there is deliberately no "assumed", "pending" or "sent" state to inflate it. */
export function deliveredCount(notices: readonly AffectedNotice[]): number {
  return notices.filter((n) => n.delivery.state === "delivered").length;
}
