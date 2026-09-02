// The desktop shell, kept thin enough that nothing important can hide in it.
//
// WHAT THIS IS. A reference host-app integration for Windows and Linux: it shows what
// a desktop application does with an Assist decision. SignalGrid is invisible to the
// worker — they use their own host app, and the gate answers allow / step_up /
// restrict / deny. This window stands in for that host app so the answer, and the
// consequence of the answer, are visible.
//
// WHAT IT IS NOT. It does not decide anything, and it does not talk to a network. The
// decision below is a FIXTURE, labelled as one on screen. That is deliberate for the
// same reason `native/android/app` does it: a shell that fetches on launch cannot be
// built or screenshotted without a reachable gate, and the first thing anyone would do
// is stub the fetch — which is a fixture with extra steps and no label.
//
// Every rule worth testing already lives in `signalgrid-assist-core` and is checked by
// `cargo test` there plus the shared conformance vectors. What is left here is layout.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use signalgrid_assist_core::{parse_assist_response, validate_endpoint, Endpoint};

/// What the window renders. Mirrors the core's decision rather than re-deriving it —
/// if this struct ever starts computing something, that computation belongs in the
/// core where a test can reach it.
#[derive(Serialize)]
struct View {
    assist: String,
    proceeds: bool,
    reasons: Vec<String>,
    obligations: Vec<String>,
    decision_id: Option<String>,
    explanation: String,
    /// Always true in this build. The UI reads it and says so; a shell that showed a
    /// fixture as though it were live would be the dishonest version of this file.
    fixture: bool,
    /// What the configured gate URL resolved to. `None` when it was refused — which
    /// is what a default build shows, because there is no gate configured.
    gate: Option<String>,
    gate_refusal: Option<String>,
}

/// The fixture: a step-up, because it is the outcome most likely to be mishandled.
/// An allow would let a shell that ignores the outcome entirely still look correct.
///
/// Shaped like the SERVED wire, not an imagined one: `/api/v1/authorize` answers
/// `{assist, decisionId, reasons}` (lib/api-spec/v1-openapi.yaml, AssistResult) and
/// declares no `obligations` field. An earlier fixture carried `"obligations":
/// ["webauthn"]`, which made the shell demonstrate a shape no server sends and hid
/// the case that matters — a step_up with nothing stated still must not proceed.
const FIXTURE_STATUS: u16 = 200;
const FIXTURE_BODY: &str = r#"{
  "assist": "step_up",
  "reasons": ["device posture is stale", "shared account in use"],
  "decisionId": "dec_fixture_0001"
}"#;

#[tauri::command]
fn decision() -> View {
    let d = parse_assist_response(FIXTURE_STATUS, Some(FIXTURE_BODY));

    // Read the gate URL from the environment and vet it through the core. Unset is the
    // normal case for this build, and it renders as a refusal rather than as a blank —
    // "no gate is configured" is a fact worth showing, not an empty field.
    //
    // VALIDATED, NEVER CONTACTED. `SIGNALGRID_GATE_URL` is the only input this shell
    // reads, and the only thing done with it is `validate_endpoint`. There is no HTTP
    // client in this crate or in the core; a usable URL is DISPLAYED as usable and the
    // decision above stays the fixture. The UI string and native/desktop/README.md say
    // the same thing, so a reader of any one of the three is not misled.
    let configured = std::env::var("SIGNALGRID_GATE_URL").ok();
    let (gate, gate_refusal) = match validate_endpoint(configured.as_deref()) {
        Endpoint::Usable(u) => (Some(u), None),
        Endpoint::Refused(r) => (None, Some(r)),
    };

    View {
        assist: d.assist.wire_name().to_string(),
        proceeds: d.assist.proceeds_without_further_action(),
        reasons: d.reasons.clone(),
        obligations: d.obligations.clone(),
        decision_id: d.decision_id.clone(),
        explanation: d.explanation(),
        fixture: true,
        gate,
        gate_refusal,
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![decision])
        .run(tauri::generate_context!())
        .expect("error while running the SignalGrid Assist desktop shell");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_fixture_is_a_step_up_and_does_not_proceed() {
        // If the fixture body is ever edited into an allow, the shell stops
        // demonstrating the case it exists to demonstrate.
        let v = decision();
        assert_eq!(v.assist, "step_up");
        assert!(!v.proceeds, "step_up must not render as proceedable");
        assert!(v.fixture, "this build must always declare itself a fixture");
    }

    #[test]
    fn the_fixture_carries_the_reasons_a_worker_would_be_shown() {
        let v = decision();
        assert!(
            !v.reasons.is_empty(),
            "a step-up with no reason is not actionable"
        );
        assert!(v.explanation.contains("posture"), "{}", v.explanation);
    }

    #[test]
    fn an_unset_gate_url_renders_as_a_refusal_not_a_blank() {
        // Only meaningful when the variable is genuinely unset, which is the default
        // for a test run; guarded so a developer with it exported does not see a
        // spurious failure.
        if std::env::var("SIGNALGRID_GATE_URL").is_ok() {
            return;
        }
        let v = decision();
        assert!(v.gate.is_none());
        assert!(
            v.gate_refusal.is_some(),
            "no gate configured must be SAID, not left empty"
        );
    }

    // ── tauri.conf.json, held by a test because CI never opens the window ────
    //
    // `cargo build --release` on both CI runners proves the executable links. It
    // proves nothing about what the window shows: the UI reaches this crate ONLY via
    // `window.__TAURI__.core.invoke("decision")`, and that global exists only when
    // `app.withGlobalTauri` is true — the Tauri 2 default is false. With it unset,
    // every launch rendered "Could not read the decision from the core" over empty
    // panels, and CI stayed green, because nothing in CI ever reads the config for
    // the key the UI depends on. This does. The config is embedded at compile time
    // so the assertion is about the file that was built, not one found at run time.
    const TAURI_CONF: &str = include_str!("../tauri.conf.json");

    #[test]
    fn the_config_exposes_the_global_tauri_object_the_ui_invokes_through() {
        let conf: serde_json::Value =
            serde_json::from_str(TAURI_CONF).expect("tauri.conf.json is valid JSON");
        assert_eq!(
            conf["app"]["withGlobalTauri"],
            serde_json::Value::Bool(true),
            "app.withGlobalTauri must be true: ui/index.html calls \
             window.__TAURI__.core.invoke, which does not exist without it"
        );
    }

    #[test]
    fn the_config_claims_no_bundle_ci_does_not_build() {
        // CI runs `cargo build --release` and uploads the bare executable. `bundle`
        // used to say `targets: "all"` — installers for every format on every OS —
        // none of which any job ever produced. A config that claims more than the
        // pipeline proves is the same defect as a doc that does.
        let conf: serde_json::Value =
            serde_json::from_str(TAURI_CONF).expect("tauri.conf.json is valid JSON");
        assert_eq!(
            conf["bundle"]["active"],
            serde_json::Value::Bool(false),
            "bundle.active must stay false until a CI job actually runs `tauri build` \
             and uploads what it made"
        );
        assert!(
            conf["bundle"].get("targets").is_none(),
            "bundle.targets names installers nothing builds; leave it absent"
        );
    }
}
