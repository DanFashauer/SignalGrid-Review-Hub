// =============================================================================
// agent-model-tap — the build-lane tap that routes a low-stakes chore's FIRST
// DRAFT to a free/local model through the DR-029 gateway (DR-032). Report-only:
// it RETURNS text and never writes the tree, gates, decides, throws, exits, or
// blocks. A miss returns null; the caller then proceeds on its deterministic
// path, or hands the task to the coordinating Claude session.
//
// It imports ONLY the routing policy (the reciprocal fence: nothing from lib/*,
// artifacts/api-server, or a connector), so it can never become a bridge into
// the product's deterministic decision path (golden rule 2). Which model runs a
// Claude session itself is NOT set here — that is the lane's owner-provisioned
// environment/gateway config; this tap only reaches the FREE/LOCAL tier for
// chores.
//
//   import { draftWithModel, isRoutingConfigured } from "./agent-model-tap.mjs";
//   const draft = await draftWithModel({ taskClass: "log-triage", input: log });
//   if (draft) use(draft.text);   // draft.provenance.verified === false, always
//   else fallBackDeterministicallyOrToClaude();
// =============================================================================
import { tierFor, TIERS, isRoutable } from "./model-routing-policy.mjs";

function note(reason) {
  // One honest line on stderr; never stdout (callers may parse stdout), never fatal.
  try { process.stderr.write(`agent-model-tap: ${reason}\n`); } catch { /* ignore */ }
}

// True only when the class routes to a routable tier AND that tier's endpoint is
// configured — so a caller can branch before spending a network call.
export function isRoutingConfigured(taskClass) {
  if (!isRoutable(taskClass)) return false;
  return Boolean(process.env.SIGNALGRID_AGENT_MODEL_BASE_URL && process.env.SIGNALGRID_AGENT_MODEL_NAME);
}

// Returns { text, model, tier, provenance:{drafted:'model', verified:false} } or
// null. NEVER throws.
export async function draftWithModel({ taskClass, system, input, timeoutMs = 20000, signal } = {}) {
  try {
    const tier = tierFor(taskClass);
    if (!TIERS[tier]?.routable) {
      // CLAUDE tier (or unknown class -> claude): by design the coordinating
      // session does this inline; the tap is not the path. Not a miss.
      return null;
    }
    const baseUrl = process.env.SIGNALGRID_AGENT_MODEL_BASE_URL;
    const modelName = process.env.SIGNALGRID_AGENT_MODEL_NAME;
    const apiKey = process.env.SIGNALGRID_AGENT_MODEL_KEY; // optional; LM Studio needs none
    if (!baseUrl || !modelName) {
      note("no endpoint — proceeding without a draft");
      return null;
    }
    if (typeof input !== "string" || input.length === 0) {
      note("no input — proceeding without a draft");
      return null;
    }

    const url = baseUrl.replace(/\/+$/, "") + "/chat/completions";
    const messages = [];
    if (system) messages.push({ role: "system", content: String(system) });
    messages.push({ role: "user", content: String(input) });

    const headers = { "content-type": "application/json" };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;

    // Bounded, non-blocking: our own timeout OR the caller's signal, whichever first.
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const reqSignal = signal ? anyOf(signal, timeoutSignal) : timeoutSignal;

    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ model: modelName, messages, temperature: 0, stream: false }),
        signal: reqSignal,
      });
    } catch (e) {
      note(e && e.name === "TimeoutError" ? "timeout — proceeding without a draft" : "unreachable — proceeding without a draft");
      return null;
    }
    if (!res.ok) {
      note(`http-${res.status} — proceeding without a draft`);
      return null;
    }
    let body;
    try { body = await res.json(); } catch { note("bad-response — proceeding without a draft"); return null; }
    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== "string" || text.length === 0) {
      note("bad-response — proceeding without a draft");
      return null;
    }
    return { text, model: modelName, tier, provenance: { drafted: "model", verified: false } };
  } catch (e) {
    // The tap must never throw. Any unexpected error degrades to "no draft".
    note(`error (${e && e.message ? e.message : "unknown"}) — proceeding without a draft`);
    return null;
  }
}

// Compose two AbortSignals without a dependency: abort when either aborts.
function anyOf(a, b) {
  if (typeof AbortSignal.any === "function") return AbortSignal.any([a, b]);
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (a.aborted || b.aborted) ctrl.abort();
  else { a.addEventListener("abort", onAbort, { once: true }); b.addEventListener("abort", onAbort, { once: true }); }
  return ctrl.signal;
}
