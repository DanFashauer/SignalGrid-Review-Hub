//! Turning an HTTP result from `/v1` into something the desktop shell may act on.
//!
//! The failure that matters here is not a crash — a crash is loud and gets fixed. It
//! is a client that receives something it does not understand and carries on as
//! though the answer were yes: a 500, a truncated body, an HTML error page from a
//! proxy, a field renamed by a newer server. Each of those is indistinguishable from
//! "allow" to code that only checks whether parsing succeeded.
//!
//! So: an unknown never lowers assurance. Anything not positively understood as a
//! decision becomes DENY, carrying a reason that says which failure it was.

use crate::assist::{Assist, AssistDecision};
use serde_json::Value;

/// Parse a gate response.
///
/// `status` is the HTTP status actually received — use `0` for "the request never
/// completed", which is the shape a timeout or DNS failure usually takes.
/// `body` is the raw body exactly as read; `None` means there was none.
pub fn parse(status: u16, body: Option<&str>) -> AssistDecision {
    // ── Transport-level outcomes ─────────────────────────────────────────────
    // A gate that could not be reached is not a gate that said yes. 5xx, 401/403 on
    // the gate itself, a timeout surfaced as status 0 — all deny, all named.
    if !(200..=299).contains(&status) {
        return AssistDecision::denied(format!(
            "the Assist gate returned HTTP {status}; no decision was made"
        ));
    }
    let body = match body {
        Some(b) if !b.trim().is_empty() => b,
        _ => {
            return AssistDecision::denied(format!(
                "the Assist gate returned HTTP {status} with an empty body"
            ))
        }
    };

    // ── Body-level outcomes ──────────────────────────────────────────────────
    let root =
        match serde_json::from_str::<Value>(body) {
            // Includes the realistic hostile case: a captive portal answering 200 with an
            // HTML login page. It parses as neither JSON nor permission.
            Err(e) => {
                return AssistDecision::denied(format!(
                    "the Assist gate's response was not a JSON object ({e})"
                ))
            }
            Ok(Value::Object(map)) => map,
            Ok(_) => return AssistDecision::denied(
                "the Assist gate's response was not a JSON object (top level was not an object)",
            ),
        };

    let decision_id = string_field(root.get("decisionId"));

    // A present-but-non-string `assist` is treated as present-and-unreadable, which
    // is DENY. Only a genuinely missing key reports as missing.
    let parsed = match root.get("assist") {
        None => None,
        Some(Value::String(s)) => Assist::parse(Some(s)),
        Some(_) => Some(Assist::Deny),
    };

    let Some(assist) = parsed else {
        return AssistDecision {
            assist: Assist::Deny,
            reasons: vec!["the Assist gate's response carried no \"assist\" field".to_string()],
            obligations: Vec::new(),
            decision_id,
        };
    };

    AssistDecision {
        assist,
        reasons: string_list(root.get("reasons")),
        obligations: string_list(root.get("obligations")),
        decision_id,
    }
}

fn string_field(v: Option<&Value>) -> Option<String> {
    match v {
        Some(Value::String(s)) if !s.trim().is_empty() => Some(s.clone()),
        _ => None,
    }
}

/// Read a list of strings, tolerating the shapes a real server actually emits.
///
/// A missing list is an EMPTY list, not an error — `reasons` is genuinely optional on
/// an allow. But entries that are not strings are DROPPED rather than stringified:
/// rendering `{"code":42}` to a worker as "{code=42}" is worse than showing nothing,
/// because it looks like an explanation and is not one.
fn string_list(v: Option<&Value>) -> Vec<String> {
    match v {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|i| match i {
                Value::String(s) if !s.trim().is_empty() => Some(s.clone()),
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── The happy path, so the deny cases below mean something ───────────────

    #[test]
    fn a_well_formed_allow_is_an_allow() {
        let d = parse(200, Some(r#"{"assist":"allow","decisionId":"dec_1"}"#));
        assert_eq!(d.assist, Assist::Allow);
        assert_eq!(d.decision_id.as_deref(), Some("dec_1"));
    }

    #[test]
    fn reasons_and_obligations_survive_the_round_trip() {
        let d = parse(
            200,
            Some(
                r#"{"assist":"step_up","reasons":["unmanaged device"],"obligations":["webauthn"]}"#,
            ),
        );
        assert_eq!(d.assist, Assist::StepUp);
        assert_eq!(d.reasons, vec!["unmanaged device".to_string()]);
        assert_eq!(d.obligations, vec!["webauthn".to_string()]);
    }

    #[test]
    fn an_unknown_field_from_a_newer_server_does_not_break_an_older_client() {
        let d = parse(
            200,
            Some(r#"{"assist":"allow","somethingAddedLater":{"a":1}}"#),
        );
        assert_eq!(d.assist, Assist::Allow);
    }

    // ── Transport failures. A gate that did not answer did not say yes ───────

    #[test]
    fn a_server_error_denies_and_names_the_status() {
        for status in [500u16, 502, 503, 504] {
            let d = parse(status, Some(r#"{"assist":"allow"}"#));
            assert_eq!(d.assist, Assist::Deny, "HTTP {status} must deny");
            assert!(d.explanation().contains(&status.to_string()));
        }
    }

    #[test]
    fn an_auth_failure_on_the_gate_itself_denies() {
        // 401/403 means we could not ask. A body containing the word "allow" must not
        // rescue it.
        assert_eq!(
            parse(401, Some(r#"{"assist":"allow"}"#)).assist,
            Assist::Deny
        );
        assert_eq!(
            parse(403, Some(r#"{"assist":"allow"}"#)).assist,
            Assist::Deny
        );
    }

    #[test]
    fn status_zero_the_shape_a_timeout_usually_takes_denies() {
        assert_eq!(parse(0, None).assist, Assist::Deny);
    }

    #[test]
    fn a_200_with_an_empty_body_denies() {
        assert_eq!(parse(200, Some("")).assist, Assist::Deny);
        assert_eq!(parse(200, Some("   ")).assist, Assist::Deny);
        assert_eq!(parse(200, None).assist, Assist::Deny);
    }

    // ── Body failures ────────────────────────────────────────────────────────

    #[test]
    fn a_captive_portal_answering_200_with_html_denies() {
        let d = parse(
            200,
            Some("<!doctype html><html><body>Sign in to WiFi</body></html>"),
        );
        assert_eq!(d.assist, Assist::Deny);
        assert!(
            d.explanation().contains("not a JSON object"),
            "{}",
            d.explanation()
        );
    }

    #[test]
    fn a_truncated_body_denies_rather_than_panicking() {
        assert_eq!(parse(200, Some(r#"{"assist":"al"#)).assist, Assist::Deny);
    }

    #[test]
    fn a_json_array_instead_of_an_object_denies() {
        let d = parse(200, Some(r#"["allow"]"#));
        assert_eq!(d.assist, Assist::Deny);
        assert!(
            d.explanation().contains("not a JSON object"),
            "{}",
            d.explanation()
        );
    }

    #[test]
    fn a_missing_assist_field_denies_and_says_which_field_was_missing() {
        let d = parse(200, Some(r#"{"decisionId":"dec_3","reasons":["x"]}"#));
        assert_eq!(d.assist, Assist::Deny);
        assert!(d.explanation().contains("assist"));
        assert_eq!(d.decision_id.as_deref(), Some("dec_3"));
    }

    #[test]
    fn an_assist_value_this_build_does_not_know_denies() {
        assert_eq!(
            parse(200, Some(r#"{"assist":"allow_with_conditions"}"#)).assist,
            Assist::Deny
        );
    }

    #[test]
    fn a_null_assist_denies() {
        assert_eq!(parse(200, Some(r#"{"assist":null}"#)).assist, Assist::Deny);
    }

    // ── Shape tolerance that must NOT become permissiveness ──────────────────

    #[test]
    fn absent_reasons_is_an_empty_list_not_a_failure() {
        let d = parse(200, Some(r#"{"assist":"allow"}"#));
        assert_eq!(d.assist, Assist::Allow);
        assert!(d.reasons.is_empty());
    }

    #[test]
    fn non_string_reasons_are_dropped_rather_than_stringified() {
        let d = parse(
            200,
            Some(r#"{"assist":"deny","reasons":[{"code":42},"real reason",null,""]}"#),
        );
        assert_eq!(d.reasons, vec!["real reason".to_string()]);
    }

    #[test]
    fn reasons_that_is_not_an_array_at_all_is_treated_as_absent() {
        let d = parse(
            200,
            Some(r#"{"assist":"deny","reasons":"a string not an array"}"#),
        );
        assert_eq!(d.assist, Assist::Deny);
        assert!(d.reasons.is_empty());
    }

    #[test]
    fn no_input_shape_produces_an_outcome_that_proceeds_unless_the_gate_said_so() {
        // The invariant behind every case above, asserted directly.
        let hostile = [
            None,
            Some(""),
            Some("null"),
            Some("0"),
            Some("[]"),
            Some("{}"),
            Some(r#"{"assist":""}"#),
            Some(r#"{"assist":" "}"#),
            Some("<html></html>"),
            Some(r#"{"assist":"ALLOW_ALL"}"#),
            Some(r#"{"Assist":"allow"}"#),
        ];
        for body in hostile {
            let d = parse(200, body);
            assert_eq!(
                d.assist,
                Assist::Deny,
                "body {body:?} must not yield anything but DENY"
            );
            assert!(!d.assist.proceeds_without_further_action());
        }
    }
}
