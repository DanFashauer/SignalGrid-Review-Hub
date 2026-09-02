// siem emitter family — public surface.
//
// The live-call gate in ./resolve is the canonical entry: nothing leaves this
// family without passing it, and this repository ships no live transport, so in
// this tree the resolved mode is always fixture. The vendor modules below are
// the formatting/adapter half — kept exported for the live path a private
// deployment would inject.
export * from "./resolve";
export * from "./webhook";
// The other two vendor adapters, on the same footing as the webhook one above and as
// itsm/adapter.ts's seven. Only `webhook` was exported, so `proof:emitter-discipline`
// could drive the signed-webhook collector and NOT the Splunk HEC one — which is part
// of why a loopback `hecUrl` went unnoticed: the family's own proof could not reach
// the adapter. No name collides (SplunkConfig/SplunkAdapter, SentinelConfig/SentinelAdapter).
export * from "./splunk";
export * from "./sentinel";
