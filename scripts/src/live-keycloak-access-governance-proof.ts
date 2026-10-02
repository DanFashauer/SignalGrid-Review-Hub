// Proof: the access-governance connector against a REAL Keycloak (row 17b).
//
// `lib/integrations/.../access-governance` grades a principal's governance state
// from an IGA/PAM bridge report. Its only evidence so far is hand-written fixtures,
// the shape of exactly the agreement the wire-truth ledger exists to question: a
// fixture written from the same assumptions as the code agrees with the code.
//
// Keycloak is not an IGA product. It reports three things that fit this shape —
// account enabled/disabled, effective roles, group membership — and nothing else.
// So this file is a BRIDGE (scripts/src, not lib/: it is a measurement, not a
// product transport) plus a proof that the bridge, driven through the REAL
// connector (guardReadOnly + normalizeReport on the path), is fail-closed:
//
//   * what Keycloak does not know (certification, segregation of duties, privilege
//     mode, lifecycle stage, sync time) is written as an explicit UNKNOWN, so the
//     verdict can never reach "authorized" from this source — `evaluate()` floors
//     at step_up;
//   * a role that reaches a user only THROUGH A GROUP is still counted (effective
//     expansion). Reading direct mappings only would grade that user in_scope.
//
// Two halves. OFFLINE always runs, from the in-file RECORDED admin-API shapes
// (written from Keycloak's DOCUMENTED defaults, before the first live run, and
// never tuned afterwards — a correction does not rewrite a recorded divergence).
// LIVE needs a loopback Keycloak and compares the wire with that fixture; every
// difference is a recorded FINDING, not a failure.
//
//   ./scripts/run-live-lanes.sh --only keycloak --keep
//   KEYCLOAK_URL=… KEYCLOAK_ADMIN_USER=… KEYCLOAK_ADMIN_PASSWORD=… \
//     pnpm run proof:live-keycloak-access-governance

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AccessGovernanceConnector,
  AccessGovernanceConnectorError,
  evaluateAccessGovernancePosture,
  normalizeReport,
  type AccessGovernanceReportRaw,
  type AccessGovernanceReportTransport,
  type AccessGovernanceVerdict,
} from "@workspace/integrations/access-governance";

const REALM = "sg-access-gov";
const CAPTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../../artifacts/live-captures/keycloak-access-governance.json");

// ── personas: synthetic, declared once ───────────────────────────────────────
// Keycloak's DOCUMENTED default-role set, written from the docs and not from a run.
const BASELINE = [
  "realm:default-roles-sg-access-gov",
  "realm:offline_access",
  "realm:uma_authorization",
  "client:account:view-profile",
  "client:account:manage-account",
];
const NURSE_SET = [...BASELINE, "realm:ward-nurse", "group:/ward-a"].sort();
const MANAGE_USERS = "client:realm-management:manage-users";

type Triple = readonly [posture: string, reason: string, action: string];
interface Persona {
  username: string;
  enabled: boolean;
  roles: string[]; // direct realm roles (seed)
  groups: string[]; // group paths (seed)
  expected: string[] | undefined; // the declared entitlement set; undefined = none declared
  wantAccount: string;
  wantScope: string;
  want: Triple;
}
const PERSONAS: Persona[] = [
  { username: "ag-nurse", enabled: true, roles: ["ward-nurse"], groups: ["/ward-a"], expected: NURSE_SET,
    wantAccount: "active", wantScope: "unknown", want: ["unverified", "GOVERNANCE_STATE_UNKNOWN", "step_up"] },
  { username: "ag-nurse-extra", enabled: true, roles: ["ward-nurse", "pharmacy-admin"], groups: ["/ward-a"], expected: NURSE_SET,
    wantAccount: "active", wantScope: "over_privileged", want: ["over_privileged", "OVER_PRIVILEGED", "step_up"] },
  // /it-helpdesk carries realm-management:manage-users, so that role reaches the
  // user ONLY through the group. The expected set names the group, not the role.
  { username: "ag-group-admin", enabled: true, roles: ["ward-nurse"], groups: ["/ward-a", "/it-helpdesk"],
    expected: [...NURSE_SET, "group:/it-helpdesk"].sort(),
    wantAccount: "active", wantScope: "over_privileged", want: ["over_privileged", "OVER_PRIVILEGED", "step_up"] },
  { username: "ag-leaver", enabled: false, roles: ["ward-nurse"], groups: ["/ward-a"], expected: NURSE_SET,
    wantAccount: "disabled", wantScope: "unknown", want: ["disabled_active", "ACCOUNT_DISABLED_ACTIVE", "escalate"] },
  { username: "ag-missing", enabled: true, roles: [], groups: ["/ward-a"], expected: NURSE_SET,
    wantAccount: "active", wantScope: "out_of_scope", want: ["unscoped", "ENTITLEMENT_OUT_OF_SCOPE", "restrict"] },
  { username: "ag-undeclared", enabled: true, roles: ["ward-nurse"], groups: [], expected: undefined,
    wantAccount: "active", wantScope: "unknown", want: ["unverified", "GOVERNANCE_STATE_UNKNOWN", "step_up"] },
];
const expectedFor = (u: string): string[] | undefined => PERSONAS.find((p) => p.username === u)?.expected;

// ── the bridge ───────────────────────────────────────────────────────────────
/** The admin-API response shapes the bridge reads (loosely typed on purpose). */
export interface AdminResp {
  user: { username?: unknown; enabled?: unknown };
  realmComposite: unknown; //            [{name}]
  clientComposite: unknown; //           {clientId: [{name}]}
  groups: unknown; //                    [{path}]
}

/** The names under `key` in a list of objects, or null if it is not a clean list. */
function namesOf(list: unknown, key: string): string[] | null {
  if (!Array.isArray(list)) return null;
  const out: string[] = [];
  for (const it of list) {
    const v = (it as Record<string, unknown> | null)?.[key];
    if (typeof v !== "string" || v === "") return null;
    out.push(v);
  }
  return out;
}

/** Pure mapper: admin-API shapes -> a raw access-governance report. Anything that is
 *  not a clean answer is UNKNOWN, and so is a clean one: this source NEVER emits in_scope
 *  (see the scope rule below). Axes Keycloak cannot know are
 *  written as explicit unknowns; observedAt is absent (no sync instant exists, and
 *  createdTimestamp is not one). No clock is read. */
export function reportFromAdmin(resp: AdminResp, expected: readonly string[] | undefined): AccessGovernanceReportRaw {
  const realm = namesOf(resp?.realmComposite, "name");
  const groups = namesOf(resp?.groups, "path");
  let clients: string[] | null = [];
  const cc = resp?.clientComposite;
  if (cc === null || typeof cc !== "object" || Array.isArray(cc)) clients = null;
  else {
    for (const [cid, roles] of Object.entries(cc)) {
      const n = namesOf(roles, "name");
      if (!n) { clients = null; break; }
      clients.push(...n.map((r) => `client:${cid}:${r}`));
    }
  }
  const enabled = resp?.user?.enabled;
  const status = enabled === true ? "active" : enabled === false ? "disabled" : "unknown";
  const actual = realm && groups && clients
    ? [...realm.map((r) => `realm:${r}`), ...clients, ...groups.map((g) => `group:${g}`)].sort()
    : null;
  let scope = "unknown";
  let missing: string[] = [];
  let extra: string[] = [];
  if (actual && expected !== undefined) {
    missing = expected.filter((e) => !actual.includes(e)).sort();
    extra = actual.filter((a) => !expected.includes(a)).sort();
    // never in_scope: a client or group list is unprovably complete under filtering, so "nothing
    // extra" is not proof of "nothing hidden". over_privileged rests on a role that was SEEN;
    // out_of_scope rests on a DECLARED role that was not seen, which under a filtered client or
    // group list can be an invisibility artifact: it fails toward restrict, never toward authorized.
    scope = missing.length > 0 ? "out_of_scope" : extra.length > 0 ? "over_privileged" : "unknown";
  }
  return {
    account: { status },
    entitlement: { scope, entitlements: actual ?? [], missing, extra },
    certification: { state: "unknown" },
    sod: { conflict: null },
    privilege: { mode: "unknown", sessionMonitored: null },
    lifecycle: { stage: "unknown" },
  };
}

/** GET-only: one admin-API read. 401/403 -> auth_failed, other non-2xx -> upstream_error,
 *  a non-JSON body -> bad_response. */
async function kcGet(fetchFn: typeof fetch, url: string, token: string): Promise<unknown> {
  const path = url.replace(/^https?:\/\/[^/]+/, "");
  const res = await fetchFn(url, { method: "GET", headers: { authorization: `Bearer ${token}`, accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    throw new AccessGovernanceConnectorError(res.status === 401 || res.status === 403 ? "auth_failed" : "upstream_error", `GET ${path} -> ${res.status}`, res.status);
  }
  try {
    return JSON.parse(await res.text());
  } catch {
    throw new AccessGovernanceConnectorError("bad_response", `GET ${path} returned a non-JSON body`, res.status);
  }
}

/** The GET-only fetcher, shaped as the connector's own transport (principalId = username). */
function makeKeycloakAdminTransport(
  baseUrl: string,
  realm: string,
  fetchFn: typeof fetch,
  onRaw?: (user: string, report: AccessGovernanceReportRaw) => void,
): AccessGovernanceReportTransport {
  const root = `${baseUrl.replace(/\/+$/, "")}/admin/realms/${encodeURIComponent(realm)}`;
  return async ({ principalId, token }) => {
    const get = (p: string) => kcGet(fetchFn, root + p, token);
    const hits = await get(`/users?username=${encodeURIComponent(principalId)}&exact=true`);
    const hit = Array.isArray(hits) && hits.length === 1 ? (hits[0] as Record<string, unknown>) : null;
    if (!hit || typeof hit.id !== "string" || hit.username !== principalId) {
      throw new AccessGovernanceConnectorError("upstream_error", `expected exactly one user named ${principalId}`, 404);
    }
    const id = encodeURIComponent(hit.id);
    const realmComposite = await get(`/users/${id}/role-mappings/realm/composite`);
    const clients = await get("/clients");
    let clientComposite: unknown = undefined;
    // A token holding query-clients but not view-clients got 200 with an EMPTY list on 26.4.7
    // (view-users only got 403 on /clients: auth_failed). A list holding
    // both built-ins proves nothing (the mapper never grades in_scope for that reason), but every
    // realm has the built-in account + realm-management clients, so a list missing either is a
    // broken answer and clientComposite stays undefined (the mapper grades unknown).
    const ids = Array.isArray(clients) ? (clients as Record<string, unknown>[]).map((c) => c?.clientId) : [];
    if (Array.isArray(clients) && ids.includes("account") && ids.includes("realm-management")) {
      // null-prototype: a client named "__proto__" must be an own key, not a prototype swap
      const acc: Record<string, unknown> = Object.create(null);
      for (const c of clients as Record<string, unknown>[]) {
        if (typeof c?.id !== "string" || typeof c.clientId !== "string") throw new AccessGovernanceConnectorError("bad_response", "a client without id/clientId", 200);
        const roles = await get(`/users/${id}/role-mappings/clients/${encodeURIComponent(c.id)}/composite`);
        if (!Array.isArray(roles) || roles.length > 0) acc[c.clientId] = roles; // a non-array stays visible so the mapper grades unknown
      }
      clientComposite = acc;
    }
    const groups = await get(`/users/${id}/groups`);
    const report = reportFromAdmin({ user: hit, realmComposite, clientComposite, groups }, expectedFor(principalId));
    onRaw?.(principalId, report);
    return report;
  };
}

// ── RECORDED admin-API shapes (documented defaults; written BEFORE the first run) ─
const R = (...n: string[]) => n.map((name) => ({ name }));
const DEFAULT_REALM = R("default-roles-sg-access-gov", "offline_access", "uma_authorization");
const DEFAULT_CLIENT = { account: R("view-profile", "manage-account") };
const user = (username: string, enabled: boolean) => ({ username, enabled });
const RECORDED: Record<string, AdminResp> = {
  "ag-nurse": { user: user("ag-nurse", true), realmComposite: [...DEFAULT_REALM, ...R("ward-nurse")], clientComposite: DEFAULT_CLIENT, groups: [{ path: "/ward-a" }] },
  "ag-nurse-extra": { user: user("ag-nurse-extra", true), realmComposite: [...DEFAULT_REALM, ...R("ward-nurse", "pharmacy-admin")], clientComposite: DEFAULT_CLIENT, groups: [{ path: "/ward-a" }] },
  "ag-group-admin": {
    user: user("ag-group-admin", true),
    realmComposite: [...DEFAULT_REALM, ...R("ward-nurse")],
    clientComposite: { ...DEFAULT_CLIENT, "realm-management": R("manage-users") },
    groups: [{ path: "/ward-a" }, { path: "/it-helpdesk" }],
  },
  "ag-leaver": { user: user("ag-leaver", false), realmComposite: [...DEFAULT_REALM, ...R("ward-nurse")], clientComposite: DEFAULT_CLIENT, groups: [{ path: "/ward-a" }] },
  "ag-missing": { user: user("ag-missing", true), realmComposite: [...DEFAULT_REALM], clientComposite: DEFAULT_CLIENT, groups: [{ path: "/ward-a" }] },
  "ag-undeclared": { user: user("ag-undeclared", true), realmComposite: [...DEFAULT_REALM, ...R("ward-nurse")], clientComposite: DEFAULT_CLIENT, groups: [] },
};

/** A fetch that answers the four admin GETs the transport makes, from RECORDED. */
function stubFetch(recorded: Record<string, AdminResp>, override?: (url: string) => unknown): typeof fetch {
  return (async (input: unknown) => {
    const url = String(input);
    const path = url.replace(/^https?:\/\/[^/]+/, "");
    const body = (b: unknown, status = 200) => new Response(typeof b === "string" ? b : JSON.stringify(b), { status });
    const o = override?.(path);
    if (o !== undefined) return o instanceof Response ? o : body(o);
    const q = path.match(/^\/admin\/realms\/[^/]+\/users\?username=([^&]+)&exact=true$/);
    if (q) {
      const u = decodeURIComponent(q[1] as string);
      return body(recorded[u] ? [{ id: `id-${u}`, ...recorded[u].user }] : []);
    }
    const m = path.match(/^\/admin\/realms\/[^/]+\/users\/id-([^/]+)\/(.+)$/);
    const rec = m ? recorded[m[1] as string] : undefined;
    if (rec && m) {
      if (m[2] === "role-mappings/realm/composite") return body(rec.realmComposite);
      if (m[2] === "groups") return body(rec.groups);
      const c = m[2]?.match(/^role-mappings\/clients\/cid-([^/]+)\/composite$/);
      if (c) return body((rec.clientComposite as Record<string, unknown>)[c[1] as string] ?? []);
    }
    if (/^\/admin\/realms\/[^/]+\/clients$/.test(path)) {
      return body(["account", "realm-management", "broker"].map((clientId) => ({ id: `cid-${clientId}`, clientId })));
    }
    return body({ error: "not found" }, 404);
  }) as typeof fetch;
}

// ── harness ──────────────────────────────────────────────────────────────────
let passed = 0;
let total = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  total += 1;
  if (ok) {
    passed += 1;
    console.log(`  ok — ${name}`);
  } else {
    failures.push(name);
    console.log(`  ✗  — ${name}${detail ? ` (${detail})` : ""}`);
  }
}
const tripleOf = (v: AccessGovernanceVerdict): Triple => [v.posture, v.reasonCode, v.recommendedAction];
const same = (a: readonly unknown[], b: readonly unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);

interface Graded {
  raw: AccessGovernanceReportRaw;
  account: string;
  scope: string;
  unreported: string;
  verdict: AccessGovernanceVerdict;
  triple: Triple;
}
async function gradeAll(base: string, fetchFn: typeof fetch): Promise<Map<string, Graded>> {
  const raws = new Map<string, AccessGovernanceReportRaw>();
  const connector = new AccessGovernanceConnector(
    { accessToken: "token-for-" + base, baseUrl: base, source: "keycloak-bridge" },
    makeKeycloakAdminTransport(base, REALM, fetchFn, (u, r) => raws.set(u, r)),
  );
  const out = new Map<string, Graded>();
  for (const p of PERSONAS) {
    const posture = await connector.fetchPosture(p.username);
    const verdict = evaluateAccessGovernancePosture(posture);
    out.set(p.username, {
      raw: raws.get(p.username) ?? {},
      account: posture.accountStatus,
      scope: posture.entitlementScope,
      unreported: `certification=${posture.certification} sod=${posture.sodConflict} privilege=${posture.privilege}/${posture.privilegedSessionMonitored} lifecycle=${posture.lifecycleStage} observedAt=${posture.observedAt}`,
      verdict,
      triple: tripleOf(verdict),
    });
  }
  return out;
}
const entOf = (g: Graded): string[] => (((g.raw.entitlement as { entitlements?: unknown } | undefined)?.entitlements as string[] | undefined) ?? []);
const extraOf = (g: Graded): string[] => (((g.raw.entitlement as { extra?: unknown } | undefined)?.extra as string[] | undefined) ?? []);
/** Group expansion is real iff the group member's extra entitlements exceed a no-group
 *  persona's by EXACTLY the group-inherited role. A delta, not a bare scope, because
 *  Keycloak's own default roles drift and over-privilege EVERY persona on the wire. */
const groupExpansionHolds = (groupMemberExtra: readonly string[], baselineExtra: readonly string[]): boolean =>
  same(groupMemberExtra.filter((e) => !baselineExtra.includes(e)).sort(), [MANAGE_USERS]);
const UNREPORTED = "certification=unknown sod=null privilege=unknown/null lifecycle=unknown observedAt=null";

// ── OFFLINE ──────────────────────────────────────────────────────────────────
async function offline(): Promise<Map<string, Graded>> {
  console.log("-- offline: RECORDED admin shapes through the real connector");
  const base = "http://offline.invalid";
  const g = await gradeAll(base, stubFetch(RECORDED));

  for (const p of PERSONAS) {
    const x = g.get(p.username) as Graded;
    check(`O1 ${p.username}: account=${p.wantAccount} scope=${p.wantScope}`, x.account === p.wantAccount && x.scope === p.wantScope, `got ${x.account}/${x.scope}`);
  }
  const ga = g.get("ag-group-admin") as Graded;
  check("O1 ag-group-admin: extra names exactly the group-inherited role", same(extraOf(ga), [MANAGE_USERS]), `extra=${extraOf(ga).join(",")}`);
  const direct = { ...RECORDED["ag-group-admin"], clientComposite: DEFAULT_CLIENT } as AdminResp;
  const dRaw = reportFromAdmin(direct, expectedFor("ag-group-admin"));
  check("O1 non-vacuity: without the group-inherited role the same user has no extra entitlement and grades unknown (never in_scope)",
    extraOf({ raw: dRaw } as Graded).length === 0 && normalizeReport("x", dRaw).entitlementScope === "unknown");

  check("O2 every persona: unreported axes are unknown/null", PERSONAS.every((p) => (g.get(p.username) as Graded).unreported === UNREPORTED));

  check("O3 every persona: never authorized, action never none, certification+sod+privilege unknown",
    PERSONAS.every((p) => {
      const v = (g.get(p.username) as Graded).verdict;
      return v.posture !== "authorized" && v.recommendedAction !== "none" &&
        ["certification", "sod", "privilege"].every((s) => v.unknownSignals.includes(s));
    }));

  for (const p of PERSONAS) {
    const x = g.get(p.username) as Graded;
    check(`O4 ${p.username}: ${p.want.join(" / ")}`, same(x.triple, p.want), `got ${x.triple.join(" / ")}`);
  }

  const nurse = RECORDED["ag-nurse"] as AdminResp;
  const planted = {
    ...reportFromAdmin(nurse, NURSE_SET),
    entitlement: { scope: "in_scope", entitlements: NURSE_SET, missing: [], extra: [] },
    certification: { state: "certified" }, sod: { conflict: false }, privilege: { mode: "none", sessionMonitored: null },
  };
  const pv = evaluateAccessGovernancePosture(normalizeReport("ag-nurse", planted, "keycloak-bridge"));
  check("O5 non-vacuity: the same report with scope in_scope and the unreported axes planted DOES evaluate authorized/none",
    pv.posture === "authorized" && pv.recommendedAction === "none", tripleOf(pv).join(" / "));

  check("O6 enabled missing -> account unknown", normalizeReport("x", reportFromAdmin({ ...nurse, user: {} }, NURSE_SET)).accountStatus === "unknown");
  check("O6 enabled as a string -> account unknown", normalizeReport("x", reportFromAdmin({ ...nurse, user: { enabled: "true" } }, NURSE_SET)).accountStatus === "unknown");
  check("O6 realmComposite not an array -> scope unknown", normalizeReport("x", reportFromAdmin({ ...nurse, realmComposite: { error: "x" } }, NURSE_SET)).entitlementScope === "unknown");
  check("O6 groups not an array -> scope unknown", normalizeReport("x", reportFromAdmin({ ...nurse, groups: null }, NURSE_SET)).entitlementScope === "unknown");
  for (const [label, hits] of [["0 hits", []], ["2 hits", [{ id: "a", username: "ag-nurse" }, { id: "b", username: "ag-nurse" }]]] as const) {
    const c = new AccessGovernanceConnector({ accessToken: "t", baseUrl: base, source: "keycloak-bridge" },
      makeKeycloakAdminTransport(base, REALM, stubFetch(RECORDED, (p) => (p.includes("/users?username=") ? hits : undefined))));
    let err: unknown;
    await c.fetchPosture("ag-nurse").catch((e) => { err = e; });
    const h = await c.healthCheck("ag-nurse");
    check(`O6 username with ${label} -> upstream_error 404, healthCheck unhealthy`,
      err instanceof AccessGovernanceConnectorError && err.code === "upstream_error" && err.status === 404 && h.healthy === false);
  }
  {
    const c = new AccessGovernanceConnector({ accessToken: "t", baseUrl: base, source: "keycloak-bridge" },
      makeKeycloakAdminTransport(base, REALM, stubFetch(RECORDED, (p) => (p.endsWith("/groups") ? new Response("<html>", { status: 200 }) : undefined))));
    let err: unknown;
    await c.fetchPosture("ag-nurse").catch((e) => { err = e; });
    check("O6 a body that is not JSON -> bad_response", err instanceof AccessGovernanceConnectorError && err.code === "bad_response");
    const c2 = new AccessGovernanceConnector({ accessToken: "t", baseUrl: base, source: "keycloak-bridge" },
      makeKeycloakAdminTransport(base, REALM, stubFetch(RECORDED, (p) => (p.includes("/users?username=") ? new Response("no", { status: 401 }) : undefined))));
    let err2: unknown;
    await c2.fetchPosture("ag-nurse").catch((e) => { err2 = e; });
    check("O6 a 401 -> auth_failed", err2 instanceof AccessGovernanceConnectorError && err2.code === "auth_failed");
  }

  // O6 a client NAMED __proto__ must not drop its roles (a plain-object accumulator
  // swaps the prototype instead of adding a key: over_privileged read as in_scope).
  for (const [label, clientId] of [["control 'evil'", "evil"], ["'__proto__'", "__proto__"]] as const) {
    const cid = `cid-${clientId}`;
    const c = new AccessGovernanceConnector({ accessToken: "t", baseUrl: base, source: "keycloak-bridge" },
      makeKeycloakAdminTransport(base, REALM, stubFetch(RECORDED, (p) => {
        if (p.endsWith("/clients")) return [{ id: "cid-account", clientId: "account" }, { id: "cid-realm-management", clientId: "realm-management" }, { id: cid, clientId }];
        if (p.endsWith(`/role-mappings/clients/${cid}/composite`)) return R("super-admin");
        return undefined;
      })));
    const post = await c.fetchPosture("ag-nurse");
    check(`O6 a client named ${label} with a role -> over_privileged, never in_scope`,
      post.entitlementScope === "over_privileged", `scope=${post.entitlementScope}`);
  }

  // O6 a FILTERED /clients list is a partial read: on 26.4.7 a token holding query-clients but not
  // view-clients got 200 [] (a view-users-only token got 403 on /clients: auth_failed), which would
  // silently drop every client:* entitlement. A list without the built-in account +
  // realm-management clients is unknown.
  for (const [label, list] of [
    ["200 []", []],
    ["a list without realm-management", [{ id: "cid-account", clientId: "account" }]],
    ["a list without account", [{ id: "cid-realm-management", clientId: "realm-management" }]],
  ] as const) {
    for (const who of ["ag-nurse", "ag-nurse-extra", "ag-group-admin"]) {
      const c = new AccessGovernanceConnector({ accessToken: "t", baseUrl: base, source: "keycloak-bridge" },
        makeKeycloakAdminTransport(base, REALM, stubFetch(RECORDED, (p) => (p.endsWith("/clients") ? list : undefined))));
      const post = await c.fetchPosture(who);
      check(`O6 /clients filtered to ${label} (${who}) -> scope unknown, never in_scope/over_privileged`,
        post.entitlementScope === "unknown", `scope=${post.entitlementScope}`);
    }
  }

  // O6c NO input shape reads in_scope. Keycloak's admin API gives no proof that a client list is
  // COMPLETE: /admin/serverinfo answered 200 for every admin-role token probed on 26.4.7, so it
  // proves nothing, and a query-clients-only token got 200 []. That a fine-grained token lists
  // exactly account + realm-management is the reviewer's hypothesis, not observed; the rule covers
  // it either way. in_scope is the one loosening verdict, so this bridge never emits it.
  // over_privileged rests on a role that was SEEN; out_of_scope rests on a DECLARED role that was
  // not seen, which under a filtered list can be an invisibility artifact (it fails toward restrict).
  {
    const builtIns = [{ id: "cid-account", clientId: "account" }, { id: "cid-realm-management", clientId: "realm-management" }];
    const withApp = [...builtIns, { id: "cid-pharmacy-app", clientId: "pharmacy-app" }];
    const shapes: [string, (p: string) => unknown][] = [
      ["every client listed (account, realm-management, pharmacy-app)", (p) => (p.endsWith("/clients") ? withApp : undefined)],
      ["only the two built-ins listed (what a fine-grained token sees)", (p) => (p.endsWith("/clients") ? builtIns : undefined)],
      ["the default stub (account, realm-management, broker)", () => undefined],
    ];
    for (const [label, override] of shapes) {
      for (const p of PERSONAS) {
        const c = new AccessGovernanceConnector({ accessToken: "t", baseUrl: base, source: "keycloak-bridge" },
          makeKeycloakAdminTransport(base, REALM, stubFetch(RECORDED, override)));
        const post = await c.fetchPosture(p.username);
        check(`O6c ${label}: ${p.username} never in_scope (got ${post.entitlementScope})`, post.entitlementScope !== "in_scope");
      }
    }
    check("O6c the mapper itself: an exact match of the declared set grades unknown, not in_scope",
      normalizeReport("x", reportFromAdmin(RECORDED["ag-nurse"] as AdminResp, NURSE_SET)).entitlementScope === "unknown");
    // tightening controls, unchanged: a SEEN role beyond the declared set -> over_privileged
    const seen = new AccessGovernanceConnector({ accessToken: "t", baseUrl: base, source: "keycloak-bridge" },
      makeKeycloakAdminTransport(base, REALM, stubFetch(RECORDED, (p) => {
        if (p.endsWith("/clients")) return withApp;
        if (p.endsWith("/role-mappings/clients/cid-pharmacy-app/composite")) return R("dispense");
        return undefined;
      })));
    const sp = await seen.fetchPosture("ag-nurse");
    check("O6c control: a third client holding a role (pharmacy-app: dispense) -> over_privileged",
      sp.entitlementScope === "over_privileged", `scope=${sp.entitlementScope}`);
  }

  // O8 L5's predicate is not vacuous: it holds with the group role, fails without it, and
  // fails when a default role drifts onto BOTH personas (the shape the live wire has).
  const drift = "client:account:manage-account-links";
  check("O8 group-expansion delta holds when only manage-users is added", groupExpansionHolds([drift, MANAGE_USERS], [drift]));
  check("O8 group-expansion delta FAILS when the group role is dropped (default drift on both)", !groupExpansionHolds([drift], [drift]));
  check("O8 group-expansion delta FAILS when more than the group role is added", !groupExpansionHolds([drift, MANAGE_USERS, "realm:x"], [drift]));

  // O9 the live half fails closed by NAME and sends no credential off-loopback.
  {
    let calls = 0;
    const spy = (async () => { calls += 1; return new Response("{}", { status: 200 }); }) as typeof fetch;
    const off = await reachKeycloak("http://some-host:8080", "u", "p", spy);
    check("O9 a non-loopback KEYCLOAK_URL is refused BEFORE any request (no credential sent)", "error" in off && /non-loopback/.test(off.error) && calls === 0, `calls=${calls}`);
    for (const h of ["http://127.0.0.1:1", "http://localhost:1", "http://[::1]:1"]) {
      let n = 0;
      const dead = (async () => { n += 1; throw new TypeError("fetch failed"); }) as typeof fetch;
      const r = await reachKeycloak(h, "u", "p", dead);
      check(`O9 loopback ${h}: a dead lab -> named error, not a crash`, "error" in r && r.error === "fetch failed" && n === 1);
    }
    const bad = await reachKeycloak("http://127.0.0.1:1", "u", "p", (async () => new Response("{}", { status: 401 })) as typeof fetch);
    check("O9 wrong password -> named error", "error" in bad && /admin token request failed \(401\)/.test(bad.error));
    const noVer = await reachKeycloak("http://127.0.0.1:1", "u", "p",
      (async (u: unknown) => (String(u).includes("/token") ? new Response(JSON.stringify({ access_token: "t" })) : new Response("{}"))) as typeof fetch);
    check("O9 serverinfo without a version -> named error", "error" in noVer && /no version/.test(noVer.error));
  }

  // O10 the seed's path guard admits REALM and its subpaths, not a sibling sharing the prefix.
  check("O10 seed path guard: realm, subpath and create allowed",
    seedPathAllowed(`/admin/realms/${REALM}`) && seedPathAllowed(`/admin/realms/${REALM}/users`) && seedPathAllowed("/admin/realms"));
  check("O10 seed path guard: sibling realm refused",
    !seedPathAllowed(`/admin/realms/${REALM}-prod`) && !seedPathAllowed(`/admin/realms/${REALM}2/users`) && !seedPathAllowed("/admin/realms/master"));

  const timed = evaluateAccessGovernancePosture(normalizeReport("ag-nurse", planted, "keycloak-bridge"),
    { maxGovernanceReadAgeSeconds: 3600, referenceTime: "2026-01-01T00:00:00Z" });
  check("O7 a posed recency bound on a bridge report stays step_up+ and flags governance_read_time (no time invented)",
    timed.recommendedAction !== "none" && timed.unknownSignals.includes("governance_read_time"), tripleOf(timed).join(" / "));
  return g;
}

// ── SEED: the ONLY code that writes. Loopback only; only ever the sg-access-gov realm. ─
const SEED_ROUTE = [
  `DELETE /admin/realms/${REALM}`,
  "POST /admin/realms {realm, enabled}",
  "POST /roles (ward-nurse, pharmacy-admin)",
  "POST /groups (ward-a, it-helpdesk)",
  "POST /groups/{it-helpdesk}/role-mappings/clients/{realm-management} [manage-users]",
  "POST /users {username, enabled, groups: [paths]} (one per persona)",
  "POST /users/{id}/role-mappings/realm [direct roles]",
  "default roles NOT seeded: Keycloak assigns them itself, which is what is under test",
];

/** Loopback only, BEFORE any credentialed request: the admin password goes over plain HTTP. */
function assertLoopback(base: string, what: string): void {
  const host = new URL(base).hostname;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host)) {
    throw new Error(`${what} refuses a non-loopback host (${host}); the lab admin credentials go over plain HTTP`);
  }
}

/** The one realm the seed may touch (besides creating it): REALM itself or a path UNDER it,
 *  never a sibling that merely shares the prefix (sg-access-gov-prod). */
const seedPathAllowed = (path: string): boolean =>
  path === "/admin/realms" || path === `/admin/realms/${REALM}` || path.startsWith(`/admin/realms/${REALM}/`);

async function adminToken(base: string, adminUser: string, adminPass: string, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await fetchFn(`${base}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: "admin-cli", grant_type: "password", username: adminUser, password: adminPass }),
    signal: AbortSignal.timeout(15000),
  });
  const j = (await res.json().catch(() => ({}))) as { access_token?: unknown };
  if (!res.ok || typeof j.access_token !== "string") throw new Error(`admin token request failed (${res.status})`);
  return j.access_token;
}

/** Loopback check, then token + serverinfo. Returns the version, or the NAMED reason it
 *  could not (dead port, wrong password, non-loopback host) so L1 fails by name. */
async function reachKeycloak(base: string, adminUser: string, adminPass: string, fetchFn: typeof fetch = fetch): Promise<{ version: string } | { error: string }> {
  try {
    assertLoopback(base, "the live half");
    const token = await adminToken(base, adminUser, adminPass, fetchFn);
    const res = await fetchFn(`${base}/admin/serverinfo`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    const info = (await res.json().catch(() => ({}))) as { systemInfo?: { version?: unknown } };
    const v = info.systemInfo?.version;
    return typeof v === "string" && v !== "" ? { version: v } : { error: `no version in /admin/serverinfo (${res.status})` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

async function seedLabRealm(base: string, adminUser: string, adminPass: string): Promise<void> {
  assertLoopback(base, "seedLabRealm");
  const w = async (method: string, path: string, body?: unknown, okStatuses: number[] = []): Promise<Response> => {
    // the only realm this function may touch (besides creating it) is REALM
    if (!seedPathAllowed(path)) throw new Error(`seed refused path ${path}`);
    const res = await fetch(base + path, {
      method,
      headers: { authorization: `Bearer ${await adminToken(base, adminUser, adminPass)}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok && !okStatuses.includes(res.status)) throw new Error(`seed ${method} ${path} -> ${res.status}`);
    return res;
  };
  const idFrom = (r: Response) => (r.headers.get("location") ?? "").split("/").pop() ?? "";
  const R_ = `/admin/realms/${REALM}`;
  const getJson = async (path: string) => (await (await w("GET", path)).json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  await w("DELETE", R_, undefined, [404]);
  await w("POST", "/admin/realms", { realm: REALM, enabled: true });
  for (const name of ["ward-nurse", "pharmacy-admin"]) await w("POST", `${R_}/roles`, { name });
  const gid: Record<string, string> = {};
  for (const name of ["ward-a", "it-helpdesk"]) gid[name] = idFrom(await w("POST", `${R_}/groups`, { name }));
  const rm = (await getJson(`${R_}/clients?clientId=realm-management`))[0];
  const manageUsers = await getJson(`${R_}/clients/${rm.id}/roles/manage-users`);
  await w("POST", `${R_}/groups/${gid["it-helpdesk"]}/role-mappings/clients/${rm.id}`, [manageUsers]);
  for (const p of PERSONAS) {
    const uid = idFrom(await w("POST", `${R_}/users`, { username: p.username, enabled: p.enabled, groups: p.groups }));
    if (p.roles.length > 0) {
      const reps = [];
      for (const r of p.roles) reps.push(await getJson(`${R_}/roles/${r}`));
      await w("POST", `${R_}/users/${uid}/role-mappings/realm`, reps);
    }
  }
}

// ── LIVE ─────────────────────────────────────────────────────────────────────
async function live(base: string, adminUser: string, adminPass: string, fixture: Map<string, Graded>): Promise<boolean> {
  console.log(`-- live: ${base}`);
  const before = failures.length;
  const reached = await reachKeycloak(base, adminUser, adminPass);
  const version = "version" in reached ? reached.version : "";
  check("L1 reached a live Keycloak (serverinfo version read)", version !== "", "error" in reached ? reached.error : "");
  if (version === "") return false;

  await seedLabRealm(base, adminUser, adminPass);
  const users = (await (await fetch(`${base}/admin/realms/${REALM}/users?max=100`, {
    headers: { authorization: `Bearer ${await adminToken(base, adminUser, adminPass)}` },
  })).json().catch(() => [])) as unknown[];
  check(`L2 the seed created ${PERSONAS.length} users in ${REALM}`, Array.isArray(users) && users.length === PERSONAS.length, `found ${Array.isArray(users) ? users.length : "?"}`);

  const token = await adminToken(base, adminUser, adminPass);
  const raws = new Map<string, AccessGovernanceReportRaw>();
  const connector = new AccessGovernanceConnector({ accessToken: token, baseUrl: base, source: "keycloak-bridge" },
    makeKeycloakAdminTransport(base, REALM, fetch, (u, r) => raws.set(u, r)));
  const wire = new Map<string, Graded>();
  let fetched = 0;
  for (const p of PERSONAS) {
    try {
      const posture = await connector.fetchPosture(p.username);
      const verdict = evaluateAccessGovernancePosture(posture);
      wire.set(p.username, {
        raw: raws.get(p.username) ?? {}, account: posture.accountStatus, scope: posture.entitlementScope,
        unreported: `certification=${posture.certification} sod=${posture.sodConflict} privilege=${posture.privilege}/${posture.privilegedSessionMonitored} lifecycle=${posture.lifecycleStage} observedAt=${posture.observedAt}`,
        verdict, triple: tripleOf(verdict),
      });
      fetched += 1;
    } catch (e) {
      console.log(`  ! ${p.username}: ${e instanceof Error ? e.message : e}`);
    }
  }
  check(`L3 each persona fetched through AccessGovernanceConnector.fetchPosture over the GET-only transport (${fetched}/${PERSONAS.length})`, fetched === PERSONAS.length);
  if (fetched !== PERSONAS.length) return false;

  const all = [...wire.values()];
  const unk = all.filter((g) => g.unreported === UNREPORTED).length;
  const authz = all.filter((g) => g.verdict.posture === "authorized").length;
  console.log(`  unreported fields on the wire: all ${UNREPORTED.split(" ").length} stayed unknown for ${unk}/${all.length} personas; ${authz} graded authorized`);
  check("L4 (fail-open guard) unreported axes unknown on the wire for every persona, none graded authorized", unk === all.length && authz === 0);
  const wga = wire.get("ag-group-admin") as Graded;
  const wnu = wire.get("ag-nurse") as Graded;
  check("L5 (fail-open guard) ag-group-admin's wire extra exceeds ag-nurse's by exactly the group-inherited manage-users (group expansion is real)",
    groupExpansionHolds(extraOf(wga), extraOf(wnu)), `admin extra=[${extraOf(wga).join(",")}] nurse extra=[${extraOf(wnu).join(",")}]`);
  check("L8 (fail-open guard) no persona graded in_scope on the wire (this source cannot prove a client list complete)",
    all.every((g) => g.scope !== "in_scope"), all.map((g) => g.scope).join(","));

  // L6 — wire vs fixture, axis by axis. A difference is a FINDING, not a failure.
  const divergences: string[] = [];
  const personas = PERSONAS.map((p) => {
    const f = fixture.get(p.username) as Graded;
    const w_ = wire.get(p.username) as Graded;
    const note = (axis: string, fx: string, wx: string) => {
      if (fx !== wx) { const d = `divergence: ${p.username}.${axis} fixture=${fx} wire=${wx}`; divergences.push(d); console.log(`  ${d}`); }
    };
    note("account.status", f.account, w_.account);
    const fe = entOf(f), we = entOf(w_);
    if (!same(fe, we)) {
      const d = `divergence: ${p.username}.entitlements wire-only=[${we.filter((x) => !fe.includes(x)).join(",")}] fixture-only=[${fe.filter((x) => !we.includes(x)).join(",")}]`;
      divergences.push(d); console.log(`  ${d}`);
    }
    note("scope", f.scope, w_.scope);
    note("unreported", f.unreported, w_.unreported);
    note("verdict", f.triple.join("/"), w_.triple.join("/"));
    const shape = (g: Graded) => ({ account: g.account, entitlements: entOf(g), scope: g.scope, unreported: g.unreported, verdict: g.triple });
    return { username: p.username, fixture: shape(f), wire: shape(w_) };
  });
  const verdictLine = (divergences.length === 0
    ? `wire-vs-fixture: AGREE on every axis for ${PERSONAS.length} personas`
    : `wire-vs-fixture: DIVERGED on ${divergences.length} axes — ${divergences[0]?.replace(/^divergence: /, "")}`).replace(/"/g, "'");
  console.log(`  ${verdictLine}`);

  try {
    mkdirSync(dirname(CAPTURE), { recursive: true });
    writeFileSync(CAPTURE, JSON.stringify({
      source: "keycloak",
      capturedFrom: base,
      keycloakVersion: version,
      realm: REALM,
      provenance: {
        proof: "proof:live-keycloak-access-governance",
        kind: "wire-vs-fixture",
        note: "The fixture is the documented-default admin-API shapes committed BEFORE the first live run. A later fixture correction does not rewrite a recorded first-run divergence. No ids, timestamps or tokens are recorded.",
      },
      seedRoute: SEED_ROUTE,
      personas,
      divergences,
      verdictLine,
    }, null, 2) + "\n");
    check("L7 the capture is written", true);
  } catch (e) {
    check("L7 the capture is written", false, e instanceof Error ? e.message : String(e));
  }
  return failures.length === before;
}

async function main(): Promise<void> {
  const fixture = await offline();
  console.log(`offline summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
  if (failures.length > 0) process.exit(1);

  const base = process.env.KEYCLOAK_URL?.replace(/\/$/, "");
  const adminUser = process.env.KEYCLOAK_ADMIN_USER;
  const adminPass = process.env.KEYCLOAK_ADMIN_PASSWORD;
  if (!base || !adminUser || !adminPass) {
    console.error(
      "proof:live-keycloak-access-governance REFUSED (live half) — needs KEYCLOAK_URL + KEYCLOAK_ADMIN_USER + KEYCLOAK_ADMIN_PASSWORD; run ./scripts/run-live-lanes.sh --only keycloak",
    );
    process.exit(2);
  }
  await live(base, adminUser, adminPass, fixture);
  console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
  process.exit(failures.length === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error("proof:live-keycloak-access-governance crashed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
