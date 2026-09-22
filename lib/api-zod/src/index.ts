// Generated from `lib/api-spec/openapi.yaml` (the `/api` monitoring document) by orval.
//
// THE INPUT SCHEMAS HERE ARE CLIENT/TYPE-ONLY. `*Body`, `*QueryParams` and `*Params`
// describe what a CLIENT should send; they are not the server's boundary. The served
// `/api` handlers parse by hand, and `/v1` — a different document and a different
// surface — never imports this package at all. One input schema is invoked at runtime
// (`GetIntegrationParams.safeParse`, in `routes/integrations.ts`); reading the rest as
// validation of the served boundary is the mistake this note exists to prevent.
//
// Enforced, not promised: `scripts/check-api-zod-wiring.mjs` fails on any exported input
// schema that is neither invoked under `artifacts/api-server/src/routes/**` nor declared
// client/type-only there with a reason.
export * from "./generated/api";
export * from "./generated/types";
