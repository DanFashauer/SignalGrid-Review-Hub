// CAEP / Shared Signals emitter proof — fully OFFLINE and deterministic.
//
// Two claims proven: the FORMATTER produces a correct UNSIGNED SET claims set
// and refuses everything it cannot state honestly (an unknown event type, a
// garbled instant, an email-shaped subject); and the GATE is the same
// unanimous fail-closed four-clause gate as the other five emitter families,
// with a fixture emitter whose records cannot claim delivery.
import {
  buildCaepClaims,
  resolveCaepEmitter,
  CAEP_EVENT_TYPES,
  type CaepClaimsInput,
} from "@workspace/integrations/caep-events";

let passed = 0;
const failures: string[] = [];
const check = (name: string, ok: boolean): void => {
  if (ok) { passed += 1; console.log(`  ok — ${name}`); }
  else { failures.push(name); console.log(`  FAIL — ${name}`); }
};

console.log("CAEP / Shared Signals emitter proof");

const clean = (over: CaepClaimsInput = {}): CaepClaimsInput => ({
  issuer: "https://signalgrid.example/tx",
  audience: "https://ehr.example/rx",
  jti: "dec-3cb72f",
  issuedAt: "2026-07-31T15:00:05Z",
  subjectPseudonym: "wf-pseud-91c4",
  eventKind: "session_revoked",
  occurredAt: "2026-07-31T15:00:00Z",
  reasonCodes: ["PRESENCE_EVIDENCE_EXPIRED", "GATEWAY_RESTRICTED"],
  ...over,
});

// ── the formatter ───────────────────────────────────────────────────────────────
const built = buildCaepClaims(clean());
check("a clean input builds the RFC 8417 claims-set shape: iss/aud/jti/iat, opaque sub_id, and ONE CAEP event keyed by its OpenID URI",
  built.refusal === null &&
  built.claims?.iss === "https://signalgrid.example/tx" &&
  built.claims?.sub_id.format === "opaque" && built.claims?.sub_id.id === "wf-pseud-91c4" &&
  Object.keys(built.claims?.events ?? {}).length === 1 &&
  built.claims?.events["https://schemas.openid.net/secevent/caep/event-type/session-revoked"] !== undefined);
check("instants are SUPPLIED, converted to epoch seconds — iat from issuedAt, event_timestamp from occurredAt; no clock ran",
  built.claims?.iat === Math.floor(Date.parse("2026-07-31T15:00:05Z") / 1000) &&
  built.claims?.events["https://schemas.openid.net/secevent/caep/event-type/session-revoked"]?.event_timestamp ===
    Math.floor(Date.parse("2026-07-31T15:00:00Z") / 1000));
check("the fabric's reason codes travel as reason_admin — the auditable why crosses with the event",
  built.claims?.events["https://schemas.openid.net/secevent/caep/event-type/session-revoked"]?.reason_admin.en ===
    "PRESENCE_EVIDENCE_EXPIRED, GATEWAY_RESTRICTED");
const stringLeaves = (v: unknown): string[] =>
  typeof v === "string" ? [v]
  : typeof v === "object" && v !== null ? Object.values(v as Record<string, unknown>).flatMap(stringLeaves)
  : [];
check("THE UNSIGNED PIN: the result is a claims OBJECT and no string value in it is JWT-shaped (three base64url segments) — nothing here can be mistaken for a signed SET",
  typeof built.claims === "object" && built.claims !== null &&
  stringLeaves(built.claims).every((s) => !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s)));
check("all five CAEP event kinds build, each keyed by its own URI",
  (Object.keys(CAEP_EVENT_TYPES) as Array<keyof typeof CAEP_EVENT_TYPES>).every((kind) => {
    const r = buildCaepClaims(clean({ eventKind: kind }));
    return r.refusal === null && r.claims?.events[CAEP_EVENT_TYPES[kind]] !== undefined;
  }));

// ── refusals: everything the formatter cannot state honestly ────────────────────
check("an event kind outside the allowlist refuses — never passed through as a URI the receiver must guess at",
  buildCaepClaims(clean({ eventKind: "session-revoked" })).refusal === "EVENT_KIND_UNRECOGNIZED" &&
  buildCaepClaims(clean({ eventKind: "novel-event" })).refusal === "EVENT_KIND_UNRECOGNIZED");
check("THE PSEUDONYM TRIPWIRE: an email-shaped subject refuses — a cross-system session signal is the easiest place to leak a workforce identity",
  buildCaepClaims(clean({ subjectPseudonym: "dan@example.com" })).refusal === "SUBJECT_SUSPECT");
check("garbled or missing instants refuse (issuedAt and occurredAt each)",
  buildCaepClaims(clean({ issuedAt: "just now" })).refusal === "ISSUED_AT_UNREADABLE" &&
  buildCaepClaims(clean({ occurredAt: undefined })).refusal === "OCCURRED_AT_UNREADABLE");
check("missing issuer / audience / jti / subject each refuse with their own reason",
  buildCaepClaims(clean({ issuer: " " })).refusal === "ISSUER_MISSING" &&
  buildCaepClaims(clean({ audience: undefined })).refusal === "AUDIENCE_MISSING" &&
  buildCaepClaims(clean({ jti: undefined })).refusal === "JTI_MISSING" &&
  buildCaepClaims(clean({ subjectPseudonym: undefined })).refusal === "SUBJECT_MISSING");
check("reason codes must be a non-empty bounded list of strings — an event with no stated why is not an auditable signal",
  buildCaepClaims(clean({ reasonCodes: [] })).refusal === "REASON_CODES_UNREADABLE" &&
  buildCaepClaims(clean({ reasonCodes: "expired" })).refusal === "REASON_CODES_UNREADABLE" &&
  buildCaepClaims(clean({ reasonCodes: Array.from({ length: 33 }, () => "R") })).refusal === "REASON_CODES_UNREADABLE");

// ── the gate: four clauses, all mandatory — the sixth emitter family ────────────
const noop = async () => {};
const armed = {
  SIGNALGRID_TIER: "beta",
  SIGNALGRID_LIVE_INTEGRATIONS: "true",
  CAEP_EMITTER_TOKEN: "tok",
} as NodeJS.ProcessEnv;
check("fully armed WITH an injected transport resolves live",
  resolveCaepEmitter(armed, noop).mode === "live");
check("without an injected transport the armed env still resolves fixture — this repository ships no delivery code and no signing keys",
  resolveCaepEmitter(armed).mode === "fixture");
check("dev tier never emits, whatever else is set",
  resolveCaepEmitter({ ...armed, SIGNALGRID_TIER: "dev" }, noop).mode === "fixture");
check("the live flag must be the exact lowercase string 'true'",
  resolveCaepEmitter({ ...armed, SIGNALGRID_LIVE_INTEGRATIONS: "TRUE" }, noop).mode === "fixture");
check("a missing or blank credential resolves fixture; an empty env resolves fixture with a stated reason",
  resolveCaepEmitter({ ...armed, CAEP_EMITTER_TOKEN: " " }, noop).mode === "fixture" &&
  resolveCaepEmitter({} as NodeJS.ProcessEnv).mode === "fixture");
const fixture = resolveCaepEmitter({} as NodeJS.ProcessEnv);
check("a fixture record can NEVER claim delivery — delivered:false and mode:'fixture' on every entry, sequenced deterministically",
  fixture.mode === "fixture" && (() => {
    const a = fixture.emitter.record({ probe: 1 });
    const b = fixture.emitter.record({ probe: 2 });
    return a.delivered === false && b.delivered === false && a.mode === "fixture" && a.seq === 1 && b.seq === 2;
  })());

// Determinism.
check("the formatter is deterministic",
  JSON.stringify(buildCaepClaims(clean())) === JSON.stringify(buildCaepClaims(clean())));

const total = passed + failures.length;
console.log(`figures=eventKinds=${Object.keys(CAEP_EVENT_TYPES).length},gateClauses=4,fixtureRecordsNeverDelivered=1`);
console.log(`summary=${failures.length === 0 ? "pass" : "fail"} (${passed}/${total})`);
if (failures.length > 0) { console.error("Failed checks:"); for (const f of failures) console.error(`  - ${f}`); process.exitCode = 1; }
