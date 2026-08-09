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
const FIXTURE_STATUS: u16 = 200;
const FIXTURE_BODY: &str = r#"{
  "assist": "step_up",
  "reasons": ["device posture is stale", "shared account in use"],
  "obligations": ["webauthn"],
  "decisionId": "dec_fixture_0001"
}"#;

#[tauri::command]
fn decision() -> View {
    let d = parse_assist_response(FIXTURE_STATUS, Some(FIXTURE_BODY));

    // Read the gate URL from the environment and vet it through the core. Unset is the
    // normal case for this build, and it renders as a refusal rather than as a blank —
    // "no gate is configured" is a fact worth showing, not an empty field.
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
}
