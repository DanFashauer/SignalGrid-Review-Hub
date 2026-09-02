// WHAT MAY LEAVE — the declared outbound field set, per builder, for the six
// emitter families.
//
// THE HOLE THIS FILLS. `adapters/emit-gate.ts` and each family's `resolve.ts`
// answer ONE question — "may I send at all" (tier, live flag, credential). Nothing
// answered the second one: "what may I send", and every field crossing to a vendor
// was undocumented.
//
// An independent fail-closed read of the six families on 2026-09-02 reported 27
// payload-construction sites and 17 whole-object copies at 7 sites. Those figures
// are THAT READ'S, cited not re-measured, and nothing here holds them — this file's
// own census is the count of entries below, printed on every run of
// `scripts/check-emit-payload-discipline.mjs`.
//
// A whole-object copy is not a bug you can see: it is a field that starts crossing to a customer's SIEM or
// service desk the day somebody widens a type three files away, with no edit at the
// boundary and nothing to review.
//
// NONE OF IT IS REACHABLE FROM PRODUCTION CODE TODAY. Only `scripts/src` proofs
// construct these adapters; no host app wires a caller. That is exactly why this
// landed now — closing it before the first caller exists costs one file, and after
// it costs a migration.
//
// THE RULE, decided and implemented rather than argued each time:
//
//   1. TYPED SUB-OBJECTS ARE COPIED FIELD BY FIELD. `actor`, `device`, `session`,
//      `location` and the evidence element shape are named field by field at every
//      builder, so an upstream addition never crosses unchosen.
//   2. THE UNTYPED MAPS ARE KEPT, AND DECLARED. Three fields are genuinely the
//      caller's own open slot — `SIEMEventRequest.customFields`, `evidence[].data`,
//      and the webhook `data` slot — plus the generic-webhook template context.
//      They are `Record<string, unknown>` BY DESIGN; pinning them would be a false
//      closure. So each stays, each builder names it as the open slot in a comment,
//      each is listed as `open` below, and the docs name it. One sanctioned open
//      slot per family, stated — not a silent copy of everything.
//
// WHO READS THIS. Two readers, one source, deliberately:
//
//   · `scripts/src/emit-gate-proof.ts` imports it and asserts the key set actually
//     emitted (captured off `fetch`) is a subset of what is declared here, with a
//     planted undeclared key allowed to surface ONLY in an open slot.
//   · `scripts/check-emit-payload-discipline.mjs` reads it lexically and exempts a
//     whole-object copy only where an open slot declares that exact expression —
//     by declaration, never by special case.
//
// It is not imported by the builders at runtime, on purpose: a builder that looked
// its own field list up would make the list the source of truth and the code the
// copy, which is the fossil shape this repository keeps deleting. The code is the
// source of truth; this file is the declaration the gate and the proof hold it to.
//
// STATUS: GATED. Every entry below is machine-checked in both directions (the proof
// from the wire, the gate from the source). What is REPORTED rather than gated is
// named in docs/DATA_RETENTION_AND_PERSONAL_DATA.md — chiefly that the CONTENT a
// caller puts in an open slot is the caller's to govern, and this repository cannot
// see it.

/** One sanctioned open slot: a `Record<string, unknown>` the caller owns. */
export interface OpenSlot {
  /** The key it appears under in the emitted payload. `"*"` means FLATTENED into
   *  the payload's top level (only sentinel, whose Custom Log format is flat). */
  readonly slot: string;
  /** The exact source expression the builder uses. The lexical gate exempts this
   *  spelling in this module and no other — so a second copy elsewhere still fails. */
  readonly source: string;
  /** Why it is open. An open slot with no stated reason is a silent copy with a
   *  label on it. */
  readonly why: string;
}

/** One outbound payload builder and the closed set of top-level keys it emits. */
export interface OutboundBuilder {
  /** Emitter family directory name — matches the derived family set in
   *  `scripts/src/emit-gate-proof.ts` (a directory whose resolve.ts imports
   *  createEmitterResolver). */
  readonly family: string;
  /** Module path relative to `lib/integrations/src/integrations/`. */
  readonly module: string;
  /** Class-qualified builder name, for a human reading a failure. */
  readonly builder: string;
  /**
   * Where this object sits inside the request body, as a path from the parsed
   * body: `""` is the body itself, `"ticket"` is `body.ticket`, `"0"` is `body[0]`.
   * `null` means it never becomes a fetch body at all — see `note`.
   */
  readonly bodyPath: string | null;
  /** The CLOSED set of top-level keys. Anything else is a defect. */
  readonly closed: readonly string[];
  /** The sanctioned open slots. Usually empty. */
  readonly open: readonly OpenSlot[];
  /** Anything a reader needs that the fields above cannot say. */
  readonly note?: string;
}

/**
 * The typed sub-object shapes of `SIEMEventRequest` (adapters/types.ts:66-104),
 * restated here as data so the proof can assert nested key sets too.
 *
 * NOT a second source of truth for the type — it is the ASSERTION TARGET. If the
 * interface gains a field and a builder is updated to copy it, this list fails
 * until it is updated too, which is the review step the whole change exists to
 * create. If the interface gains a field and no builder copies it, nothing here
 * changes and nothing crosses. Both outcomes are the intended one.
 */
export const SIEM_TYPED_SUBOBJECTS: Readonly<Record<string, readonly string[]>> = {
  actor: ["userId", "badgeUid", "email", "name"],
  device: ["deviceId", "platform", "ip", "mac", "tags"],
  session: ["sessionId", "startedAt", "endedAt", "duration"],
  location: ["zone", "building", "floor", "coordinates"],
  "location.coordinates": ["lat", "lng"],
  "evidence[]": ["type", "timestamp", "data"],
};

/**
 * NAME-EQUIVALENTS, stated because a reader scanning the closed sets below for
 * personal data will otherwise miss them: `userEmail` / `userName` (ITSM) and
 * `actor.email` / `actor.name` (SIEM) are the SAME workforce identity under two
 * vendor vocabularies, as are `badgeUid` and `location.coordinates`. They are named
 * fields, not open slots — every one is a deliberate copy — and they are listed
 * again in docs/DATA_RETENTION_AND_PERSONAL_DATA.md so the outbound surface can be
 * read without reading this file.
 */
export const PERSONAL_DATA_FIELDS: readonly string[] = [
  "userEmail",
  "userName",
  "userId",
  "actor.email",
  "actor.name",
  "actor.userId",
  "actor.badgeUid",
  "badgeUid",
  "device.ip",
  "device.mac",
  "location.coordinates",
];

export const OUTBOUND_BUILDERS: readonly OutboundBuilder[] = [
  // ── itsm ───────────────────────────────────────────────────────────────────
  {
    family: "itsm",
    module: "itsm/zendesk.ts",
    builder: "ZendeskAdapter.buildTicketPayload",
    bodyPath: "ticket",
    closed: ["subject", "description", "priority", "tags", "requester", "custom_fields"],
    open: [],
  },
  {
    family: "itsm",
    module: "itsm/jira.ts",
    builder: "JiraAdapter.createJSMRequest",
    bodyPath: "",
    closed: ["serviceDeskId", "requestTypeId", "requestFieldValues", "requester"],
    open: [],
    note: "The JSM path. `rawEvent` is deliberately NOT rendered into the description any more — see the note in buildDescription.",
  },
  {
    family: "itsm",
    module: "itsm/jira.ts",
    builder: "JiraAdapter.createJiraIssue",
    bodyPath: "",
    closed: ["fields"],
    open: [],
  },
  {
    family: "itsm",
    module: "itsm/servicenow.ts",
    builder: "ServiceNowAdapter.buildIncidentPayload",
    bodyPath: "",
    closed: [
      "short_description",
      "description",
      "impact",
      "urgency",
      "category",
      "subcategory",
      "source",
      "correlation_id",
      "cmdb_ci",
    ],
    open: [],
  },
  {
    family: "itsm",
    module: "itsm/freshservice.ts",
    builder: "FreshserviceAdapter.buildTicketPayload",
    bodyPath: "",
    closed: [
      "subject",
      "description",
      "priority",
      "urgency",
      "status",
      "ticket_type",
      "source",
      "tags",
      "requester_email",
      "requester_id",
      "custom_fields",
    ],
    open: [],
    note: "`custom_fields` here is CLOSED, not an open slot: the adapter builds it from four named request fields (correlation_id, device_id, device_name, device_platform).",
  },
  {
    family: "itsm",
    module: "itsm/bmc-helix.ts",
    builder: "BMCHelixAdapter.buildIncidentPayload",
    bodyPath: "",
    closed: [
      "Summary",
      "Description",
      "Impact",
      "Urgency",
      "Priority",
      "Category",
      "Subcategory",
      "Source",
      "CorrelationId",
      "RequesterEmail",
      "RequesterFullName",
      "RequesterId",
      "AffectedService",
      "ConfigurationItem",
      "Links",
    ],
    open: [],
    note: "`Links` is a JSON string built FIELD BY FIELD from the four optional URLs on ITSMTicketRequest (adapters/types.ts:22-27). It was `JSON.stringify(request.links)` — legal under every rule the gate enforces, since links is a closed typed object, but against the rule this batch STATES, and a fifth URL added upstream would have crossed unchosen.",
  },
  {
    family: "itsm",
    module: "itsm/ivanti.ts",
    builder: "IvantiAdapter.buildIncidentPayload",
    bodyPath: "",
    closed: [
      "Subject",
      "Description",
      "Impact",
      "Urgency",
      "Category",
      "Source",
      "TemplateId",
      "ExternalCorrelationId",
      "Email",
      "FullName",
      "EmployeeId",
      "AssetId",
      "Asset",
    ],
    open: [],
  },
  {
    family: "itsm",
    module: "itsm/manageengine.ts",
    builder: "ManageEngineAdapter.buildWorkOrderPayload",
    bodyPath: "",
    closed: [
      "subject",
      "description",
      "impact",
      "urgency",
      "priority",
      "requestType",
      "category",
      "site",
      "requester",
      "affected_resource",
      "custom_fields",
    ],
    open: [],
  },
  {
    family: "itsm",
    module: "itsm/generic-webhook.ts",
    builder: "buildTemplateContext",
    bodyPath: null,
    closed: [
      "deviceId",
      "userId",
      "badgeUid",
      "location",
      "requestId",
      "timestamp",
      "title",
      "description",
      "severity",
      "category",
      "source",
      "userEmail",
      "userName",
      "deviceName",
    ],
    open: [
      {
        slot: "(template variables)",
        source: "request.rawEvent",
        why:
          "THE ITSM FAMILY'S ONE OPEN SLOT, and the reason jira's raw dump could be deleted rather than kept somewhere. rawEvent is untrusted vendor passthrough; here it is spread FIRST so a sanctioned field of the same name always wins, and it never becomes the body on its own — the body is the operator's own bodyTemplate, and substituteVariables emits only the variables that template names (an unresolved one throws). So the operator, not the caller, decides which raw keys cross.",
      },
    ],
    note: "bodyPath is null: this builds a TEMPLATE CONTEXT, not a request body. The emitted body is the operator-configured bodyTemplate after substitution.",
  },

  // The five ticket DESCRIPTION builders. They return prose, not an object, so
  // `closed` names the REQUEST FIELDS each one renders into that prose rather than
  // JSON keys — and that is the point: a description is still a field set crossing
  // to a vendor, and jira's used to render `rawEvent` whole into it, where a
  // top-level key check could never have seen it. `bodyPath` is null because the
  // string is embedded in the payload the sibling builder above constructs.
  {
    family: "itsm",
    module: "itsm/zendesk.ts",
    builder: "ZendeskAdapter.buildDescription",
    bodyPath: null,
    closed: ["source", "category", "severity", "correlationId", "description", "userName", "userEmail", "userId", "deviceId", "deviceName", "devicePlatform", "links.dashboard", "links.auditLog", "links.device", "links.session"],
    open: [],
  },
  {
    family: "itsm",
    module: "itsm/freshservice.ts",
    builder: "FreshserviceAdapter.buildDescription",
    bodyPath: null,
    closed: ["source", "category", "severity", "correlationId", "description", "userName", "userEmail", "userId", "deviceId", "deviceName", "devicePlatform", "links.dashboard", "links.auditLog", "links.device", "links.session"],
    open: [],
  },
  {
    family: "itsm",
    module: "itsm/ivanti.ts",
    builder: "IvantiAdapter.buildDescription",
    bodyPath: null,
    closed: ["source", "category", "severity", "correlationId", "description", "userName", "userEmail", "userId", "deviceId", "deviceName", "devicePlatform", "links.dashboard", "links.auditLog", "links.device", "links.session"],
    open: [],
  },
  {
    family: "itsm",
    module: "itsm/manageengine.ts",
    builder: "ManageEngineAdapter.buildDescription",
    bodyPath: null,
    closed: ["source", "category", "severity", "correlationId", "description", "userName", "userEmail", "userId", "deviceId", "deviceName", "devicePlatform", "links.dashboard", "links.auditLog", "links.device", "links.session"],
    open: [],
  },
  {
    family: "itsm",
    module: "itsm/jira.ts",
    builder: "JiraAdapter.buildDescription",
    bodyPath: null,
    closed: ["source", "category", "severity", "correlationId", "description", "userName", "userEmail", "userId", "deviceId", "deviceName", "devicePlatform"],
    open: [],
    note: "The one that carried the defect. `request.rawEvent` was dumped here as pretty-printed JSON and is now deliberately absent; the note in the method says why it will not come back. This builder also renders no links, unlike its four siblings.",
  },

  // ── siem ───────────────────────────────────────────────────────────────────
  {
    family: "siem",
    module: "siem/splunk.ts",
    builder: "SplunkAdapter.buildEventPayload",
    bodyPath: "",
    closed: ["time", "host", "index", "source", "sourcetype", "event"],
    open: [],
  },
  {
    family: "siem",
    module: "siem/splunk.ts",
    builder: "SplunkAdapter.buildEventPayload#event",
    bodyPath: "event",
    closed: [
      "type",
      "severity",
      "timestamp",
      "caseId",
      "requestId",
      "correlationId",
      "actor",
      "device",
      "session",
      "location",
      "evidence",
      "customFields",
    ],
    open: [
      {
        slot: "customFields",
        source: "event.customFields",
        why: "Record<string, unknown> on SIEMEventRequest — the caller's declared escape hatch, carried under its own key rather than merged into the event.",
      },
      {
        slot: "evidence[].data",
        source: "e.data",
        why: "Record<string, unknown> inside a closed evidence element shape (type, timestamp, data).",
      },
    ],
  },
  {
    family: "siem",
    module: "siem/sentinel.ts",
    builder: "SentinelAdapter.buildEventPayload",
    bodyPath: "0",
    closed: [
      "TimeGenerated",
      "EventType",
      "Severity",
      "CaseId",
      "RequestId",
      "CorrelationId",
      "ActorUserId",
      "ActorBadgeUid",
      "ActorEmail",
      "ActorName",
      "DeviceId",
      "DevicePlatform",
      "DeviceIp",
      "DeviceMac",
      "DeviceTags",
      "SessionId",
      "SessionStartedAt",
      "SessionEndedAt",
      "SessionDuration",
      "LocationZone",
      "LocationBuilding",
      "LocationFloor",
      "LocationLat",
      "LocationLng",
      "Evidence",
    ],
    open: [
      {
        slot: "*",
        source: "event.customFields",
        why: "THE ONE FLATTENED OPEN SLOT in the whole surface. Sentinel's Custom Log format has no nesting, so customFields is merged into the row's top level rather than carried under a key. WRITE ORDER IS PART OF THE DECLARATION: the merge happens FIRST and every sanctioned column is written after it, unconditionally, so a caller key named ActorEmail or TimeGenerated cannot occupy a column SignalGrid derived. It used to be the last write before return, which is the opposite direction from the only other ordering decision in the tree (itsm/generic-webhook.ts) and would have let a caller assert an actor this fabric never observed.",
      },
    ],
    note: "The body is a one-element array (`JSON.stringify([payload])`), hence bodyPath \"0\". `Evidence` is a JSON string of the closed element shape, not the raw array. Every sanctioned column is written unconditionally so that an absent value still overwrites a colliding caller key; JSON.stringify drops the resulting undefined, so the wire body is unchanged for an honest caller.",
  },
  {
    family: "siem",
    module: "siem/webhook.ts",
    builder: "WebhookSIEMAdapter.buildEventPayload",
    bodyPath: "",
    closed: [
      "type",
      "severity",
      "timestamp",
      "caseId",
      "requestId",
      "correlationId",
      "actor",
      "device",
      "session",
      "location",
      "evidence",
      "customFields",
    ],
    open: [
      {
        slot: "customFields",
        source: "event.customFields",
        why: "Record<string, unknown> on SIEMEventRequest — the caller's declared escape hatch.",
      },
      {
        slot: "evidence[].data",
        source: "e.data",
        why: "Record<string, unknown> inside a closed evidence element shape.",
      },
    ],
    note: "This builder REPLACED `JSON.stringify(event)` — the entire inbound request, verbatim, to a customer-configured URL. It is also the body that is HMAC-signed, so the signature now covers a declared set.",
  },

  // ── syslog ─────────────────────────────────────────────────────────────────
  {
    family: "syslog",
    module: "syslog/transport.ts",
    builder: "SyslogAdapter.formatJSON",
    bodyPath: null,
    closed: [
      "timestamp",
      "type",
      "severity",
      "actor",
      "device",
      "session",
      "location",
      "correlationId",
      "requestId",
      "caseId",
      "customFields",
    ],
    open: [
      {
        slot: "customFields",
        source: "event.customFields",
        why: "Record<string, unknown> on SIEMEventRequest — the caller's declared escape hatch.",
      },
    ],
    note: "bodyPath is null because THIS FAMILY OPENS NO SOCKET — sendEvent() formats and then throws on the live path, by design. The proof therefore asserts the formatter's output directly. `evidence` is not emitted by this family in any format.",
  },

  {
    family: "syslog",
    module: "syslog/transport.ts",
    builder: "SyslogAdapter.formatEvent",
    bodyPath: null,
    closed: ["json", "cef", "leef"],
    open: [],
    note: "A DISPATCHER, not a constructor: it selects one of the three formatters below by config and builds nothing itself, so `closed` names the formats it may return rather than fields. Declared because it is builder-shaped and a rule that let it go unnamed would let a fourth format be added without one.",
  },
  {
    family: "syslog",
    module: "syslog/transport.ts",
    builder: "SyslogAdapter.formatCEF",
    bodyPath: null,
    closed: ["CEF version", "vendor", "product", "productVersion", "signatureId", "name", "severity", "extension"],
    open: [],
    note: "The CEF header. `signatureId` and `name` are both the event type; `extension` is buildCEPExtension below. Every value is CEF-escaped by sanitizeCEF.",
  },
  {
    family: "syslog",
    module: "syslog/transport.ts",
    builder: "SyslogAdapter.buildCEPExtension",
    bodyPath: null,
    closed: ["suser", "suserEmail", "sbadge", "dhost", "src", "smac", "devicePlatform", "sessionId", "cn1", "cn2", "cn3", "cn4"],
    open: [],
    note: "CEF extension keys, in CEF's own vocabulary. Mapped from actor.userId/email/badgeUid, device.deviceId/ip/mac/platform, session.sessionId, location.zone (cn1) and location.building (cn2), correlationId (cn3) and requestId (cn4). Already field by field before this batch — it is declared here because it was UNDECLARED, which is the hole completeness rule 7 exists for, not because it was copying whole objects.",
  },
  {
    family: "syslog",
    module: "syslog/transport.ts",
    builder: "SyslogAdapter.formatLEEF",
    bodyPath: null,
    closed: ["LEEF version", "vendor", "product", "eventId", "name", "extension"],
    open: [],
  },
  {
    family: "syslog",
    module: "syslog/transport.ts",
    builder: "SyslogAdapter.buildLEEFExtension",
    bodyPath: null,
    closed: ["usrName", "usrEmail", "badgeId", "hostName", "src", "macAddress", "os", "sessionId", "zone", "building", "floor", "correlationId", "requestId"],
    open: [],
    note: "LEEF extension keys. Note this format emits location.floor where CEF does not, and neither emits evidence or customFields — so the syslog family's declared open slot applies to the JSON format ALONE.",
  },

  // ── telemetry ──────────────────────────────────────────────────────────────
  {
    family: "telemetry",
    module: "telemetry/mde.ts",
    builder: "MDEAdapter.getAccessToken",
    bodyPath: null,
    closed: ["client_id", "client_secret", "scope", "tenant_id"],
    open: [],
    note: "An OAuth client-credentials token request, form-encoded (URLSearchParams), carrying only this adapter's own configured credentials. No caller-supplied field reaches it, so there is no open slot and nothing to plant.",
  },
  {
    family: "telemetry",
    module: "telemetry/fleetdm.ts",
    builder: "FleetDMAdapter.runLiveQuery",
    bodyPath: "",
    closed: ["query", "selected"],
    open: [],
    note: "A bounded live-query request: the caller-supplied osquery SQL and an explicit host-id list. Both are arguments, neither is a map, and the host list is required (a fleet-wide blast is refused upstream).",
  },

  // ── webhooks ───────────────────────────────────────────────────────────────
  {
    family: "webhooks",
    module: "webhooks/dispatch.ts",
    builder: "buildPayload",
    bodyPath: "",
    closed: ["id", "type", "timestamp", "source", "data", "deliveryId"],
    open: [
      {
        slot: "data",
        source: "data",
        why: "The event body the caller composes; the dispatcher does not interpret it. Bounded to one key by WebhookPayloadSchema, which is `.strict()` and — since this change — actually parsed.",
      },
    ],
  },

  // ── caep-events ────────────────────────────────────────────────────────────
  {
    family: "caep-events",
    module: "caep-events/format.ts",
    builder: "buildCaepClaims",
    bodyPath: null,
    closed: ["iss", "aud", "jti", "iat", "sub_id", "events"],
    open: [],
    note: "bodyPath is null: this family produces an UNSIGNED claims set and has no transport at all. It was already closed by construction — every field is validated or refused, and an unrecognised event kind is refused rather than passed through. It is declared here so the surface is complete, not because it needed fixing.",
  },
];

/** Every family named above. Cross-checked against the DERIVED family set (a
 *  directory whose resolve.ts imports createEmitterResolver) by the proof, so a
 *  seventh family cannot appear in the tree and be silently absent here. */
export const DECLARED_FAMILIES: readonly string[] = [
  ...new Set(OUTBOUND_BUILDERS.map((b) => b.family)),
];

/** Look one builder up by module + builder name. */
export function builderFor(module: string, builder: string): OutboundBuilder | undefined {
  return OUTBOUND_BUILDERS.find((b) => b.module === module && b.builder === builder);
}

/** The keys a payload from this builder may legitimately carry at its top level:
 *  the closed set, plus any flattened open slot (which permits ANY key — that is
 *  what `"*"` means, and why only sentinel has one). */
export function permittedTopLevel(b: OutboundBuilder): { closed: Set<string>; flattened: boolean } {
  return {
    closed: new Set(b.closed),
    flattened: b.open.some((o) => o.slot === "*"),
  };
}
