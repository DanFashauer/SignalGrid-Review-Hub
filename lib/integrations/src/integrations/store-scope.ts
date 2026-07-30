/**
 * Key scoping for the connector CONFIGURATION stores (`uem/store`, `nac/store`).
 *
 * WHY THIS FILE EXISTS. Both stores keyed their Redis entry on a flat constant —
 * `"uem:config"` and `"nac:config"` — in a repository whose every other persisted
 * reader is keyed on `(id, tenant_id)` and gated by `proof:isolation-scope`. Nothing
 * called them, so this was a latent trap rather than a live exposure, and it is worth
 * saying which: no tenant's connector selection has ever been readable by another,
 * because no code path has ever read one. But the first caller wired into a
 * multi-tenant deployment would have had one tenant's choice of UEM silently
 * overwrite every other tenant's, with no gate anywhere that would notice.
 *
 * REFUSE, DO NOT NORMALIZE. The obvious hardening — trim and lowercase the tenant id
 * before building the key — is the bug wearing the fix's clothes. Normalization is a
 * MANY-TO-ONE map, so `"Acme"` and `"acme"` would land in the same bucket; if those
 * are two tenants, that is precisely the cross-tenant bleed being fixed. Refusing a
 * non-canonical id can only ever cost an error at the call site.
 *
 * ALLOWLIST, NOT DENYLIST. A denylist bans the characters someone thought of. This
 * accepts `[A-Za-z0-9._-]` and refuses everything else, so the characters nobody
 * thought of are refused by default. That single rule subsumes the ones a denylist
 * would have had to enumerate:
 *
 *   - `""` — the empty id, which yields `"nac:config:"`: one shared bucket for every
 *     caller that forgot to pass an id. The single most likely way to reintroduce
 *     exactly the defect this file removes.
 *   - `":"` — the key separator. With the tenant as the trailing segment a colon
 *     causes no collision *within* one store, but it does ACROSS stores: prefix
 *     `"nac:config"` + tenant `"x"` and prefix `"nac"` + tenant `"config:x"` produce
 *     the same key. Two stores sharing one key is the same failure by another route.
 *   - `"*"`, `"?"`, `"["` — Redis glob metacharacters. Nothing in this repository
 *     runs `SCAN`/`KEYS` against these prefixes today; this is prophylactic and said
 *     plainly rather than dressed up as a live finding. A tenant able to name itself
 *     `*` is a landmine for whoever writes that iterator.
 *   - whitespace and control characters, which make two ids that print identically
 *     compare unequal.
 *   - non-ASCII, where NFC/NFD normalization would otherwise reintroduce the
 *     many-to-one map above through a `.normalize()` call added years from now.
 *
 * Dots are permitted because domain-shaped tenant ids (`contoso.onmicrosoft.com`) are
 * a real convention; an id consisting only of dots is refused separately, since `.`
 * and `..` are path-traversal shaped and cost nothing to exclude.
 *
 * THIS IS NOT AN AUTHORIZATION CHECK. It constrains the SHAPE of a tenant id so one
 * tenant's key cannot become another's. Deciding that a caller is entitled to act as
 * a given tenant happens at the API boundary, from the verified bearer, and this
 * function is downstream of that. A valid-shaped id is not an authorized one.
 */

/** A tenant id that cannot be used to build a key. Thrown, not returned as `null`:
 *  `null` is how these stores already say "nothing stored", and conflating "no config"
 *  with "malformed request" is the exact confusion this repository keeps finding. */
export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantScopeError";
  }
}

/** Conservative and deliberately boring. Anchored at both ends — an unanchored test
 *  would accept `"good\nbad"` on the strength of its first line. */
const TENANT_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Validate a tenant id for use as a key segment, returning it UNCHANGED.
 *
 * The unchanged return is the point, and it is why this is not called `normalize`:
 * there is no transformation to disagree about, so a caller cannot store under one
 * spelling and read under another.
 */
export function assertTenantIdForKey(tenantId: unknown): string {
  if (typeof tenantId !== "string") {
    throw new TenantScopeError(`tenant id must be a string, received ${typeof tenantId}`);
  }
  if (tenantId.length === 0) {
    throw new TenantScopeError("tenant id must not be empty — an empty id shares one key across all tenants");
  }
  if (!TENANT_ID_RE.test(tenantId)) {
    throw new TenantScopeError(
      "tenant id must match /^[A-Za-z0-9._-]{1,128}$/ — it is used verbatim as a key segment and is never normalized",
    );
  }
  if (/^\.+$/.test(tenantId)) {
    throw new TenantScopeError('tenant id must not consist only of dots (e.g. "." or "..")');
  }
  return tenantId;
}

/** True when `tenantId` is usable as a key segment. Offered so a caller can check
 *  without catching, and defined in terms of the assertion so the two can never drift
 *  apart into a permissive predicate guarding a strict writer. */
export function isValidTenantIdForKey(tenantId: unknown): boolean {
  try {
    assertTenantIdForKey(tenantId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Build a tenant-scoped store key: `"<prefix>:<tenantId>"`.
 *
 * The tenant is the TRAILING segment so the prefix stays a stable, greppable literal
 * and the variable part cannot be mistaken for structure.
 *
 * INJECTIVE over valid ids, for a fixed prefix — distinct ids give distinct keys.
 * That is trivially true of concatenation and is asserted in the proof anyway, because
 * the way it stops being true is somebody adding a `.toLowerCase()` here later.
 */
export function scopedConfigKey(prefix: string, tenantId: unknown): string {
  if (!prefix || prefix.endsWith(":")) {
    throw new TenantScopeError(`store key prefix must be non-empty and must not end in ":" (received ${JSON.stringify(prefix)})`);
  }
  return `${prefix}:${assertTenantIdForKey(tenantId)}`;
}
