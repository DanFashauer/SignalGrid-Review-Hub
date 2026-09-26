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
use serde::de::{self, Deserializer as _, MapAccess, Visitor};
use serde_json::{Map, Value};
use std::fmt;

/// Parse a gate response.
///
/// `status` is the HTTP status actually received — use `0` for "the request never
/// completed", which is the shape a timeout or DNS failure usually takes.
/// `body` is the raw body exactly as read; `None` means there was none.
///
/// A 2xx body is a decision only if it is a JSON object with no repeated top-level
/// key, a recognised `assist`, `obligations`/`reasons` each absent or a list of
/// strings, and a non-blank string `decisionId`. Anything else is DENY, whatever
/// `assist` says — the rule is the same for all four outcomes.
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
    // Includes the realistic hostile case: a captive portal answering 200 with an
    // HTML login page. It parses as neither JSON nor permission. A repeated
    // top-level key fails here too: see `object_with_unique_keys`.
    let root = match object_with_unique_keys(body) {
        Ok(map) => map,
        Err(e) => {
            return AssistDecision::denied(format!(
                "the Assist gate's response was not a JSON object ({e})"
            ))
        }
    };

    let decision_id = string_field(root.get("decisionId"));
    let refuse = |reason: &str| AssistDecision {
        assist: Assist::Deny,
        reasons: vec![reason.to_string()],
        obligations: Vec::new(),
        decision_id: decision_id.clone(),
    };

    // A present-but-non-string `assist` is treated as present-and-unreadable, which
    // is DENY. Only a genuinely missing key reports as missing.
    let parsed = match root.get("assist") {
        None => None,
        Some(Value::String(s)) => Assist::parse(Some(s)),
        Some(_) => Some(Assist::Deny),
    };
    let Some(assist) = parsed else {
        return refuse("the Assist gate's response carried no \"assist\" field");
    };

    // `obligations` is OPTIONAL-ABSENT, and absent is the served case: the
    // `/api/v1/authorize` contract (lib/api-spec/v1-openapi.yaml, AssistResult)
    // declares `assist`, `decisionId` and `reasons` only. Absent means no obligation
    // is known to be satisfied — nothing here turns an empty list into permission;
    // only `Assist::Allow` proceeds, whatever this list holds.
    //
    // PRESENT-BUT-WRONG-TYPE IS MALFORMED, and malformed is DENY — for `obligations`
    // and `reasons` alike, and for a non-string ENTRY as much as for a non-list.
    // Coercing either to empty (as this once did) let a decision stand on a body this
    // client did not understand, with an obligation silently dropped.
    let Some(obligations) = string_list(root.get("obligations")) else {
        return refuse(
            "the Assist gate's response carried an \"obligations\" field that is not a list of strings",
        );
    };
    let Some(reasons) = string_list(root.get("reasons")) else {
        return refuse(
            "the Assist gate's response carried a \"reasons\" field that is not a list of strings",
        );
    };

    // REQUIRED on every outcome (AssistResult `required: [assist, decisionId]`). Every
    // real decision is persisted and audited under its id, and a step_up is answered
    // through it; a body without one is not a decision anybody recorded.
    if decision_id.is_none() {
        return AssistDecision::denied(
            "the Assist gate's response carried no usable \"decisionId\" (the contract requires a non-blank string)",
        );
    }

    AssistDecision {
        assist,
        reasons,
        obligations,
        decision_id,
    }
}

/// Parse `body` as a JSON object whose top-level keys are all distinct.
///
/// serde_json's `Value` keeps the LAST copy of a repeated key, so
/// `{"assist":"deny","assist":"allow"}` read as allow. Keys are compared after escape
/// decoding, so `"assist"` is caught as a second `assist`. Only the top level is
/// checked: nested values are ignored fields or string lists, where a repeated key
/// cannot change anything this client reads.
fn object_with_unique_keys(body: &str) -> Result<Map<String, Value>, serde_json::Error> {
    struct UniqueKeys;
    impl<'de> Visitor<'de> for UniqueKeys {
        type Value = Map<String, Value>;
        fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
            f.write_str("a JSON object")
        }
        fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
            let mut out = Map::new();
            while let Some(key) = map.next_key::<String>()? {
                if out.contains_key(&key) {
                    return Err(de::Error::custom(format!("duplicate key \"{key}\"")));
                }
                let value = map.next_value()?;
                out.insert(key, value);
            }
            Ok(out)
        }
    }
    let mut de = serde_json::Deserializer::from_str(body);
    let map = de.deserialize_map(UniqueKeys)?;
    de.end()?;
    Ok(map)
}

fn string_field(v: Option<&Value>) -> Option<String> {
    match v {
        Some(Value::String(s)) if !s.trim().is_empty() => Some(s.clone()),
        _ => None,
    }
}

/// Read an optional list of strings.
///
/// Absent is an EMPTY list, not an error — `reasons` is genuinely optional on an allow.
/// Present must be a list whose every entry is a string; anything else is `None`,
/// which the caller turns into DENY. Blank strings are well-typed and are dropped from
/// display rather than shown as an empty explanation.
fn string_list(v: Option<&Value>) -> Option<Vec<String>> {
    match v {
        None => Some(Vec::new()),
        Some(Value::Array(items)) => items
            .iter()
            .map(|i| i.as_str().map(str::to_string))
            .collect::<Option<Vec<String>>>()
            .map(|all| all.into_iter().filter(|s| !s.trim().is_empty()).collect()),
        Some(_) => None,
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
                r#"{"assist":"step_up","decisionId":"dec_2","reasons":["unmanaged device"],"obligations":["webauthn"]}"#,
            ),
        );
        assert_eq!(d.assist, Assist::StepUp);
        assert_eq!(d.reasons, vec!["unmanaged device".to_string()]);
        assert_eq!(d.obligations, vec!["webauthn".to_string()]);
    }

    #[test]
    fn a_step_up_with_no_obligations_field_is_the_served_shape_and_does_not_proceed() {
        // The spec's AssistResult has no obligations field, so this is what the real
        // server sends. It must parse as a step_up, carry an empty list, and stay
        // non-proceedable — absent is "not stated", never "nothing required".
        let d = parse(
            200,
            Some(
                r#"{"assist":"step_up","decisionId":"dec_9","reasons":["device posture is stale"]}"#,
            ),
        );
        assert_eq!(d.assist, Assist::StepUp);
        assert!(d.obligations.is_empty());
        assert!(!d.assist.proceeds_without_further_action());
    }

    #[test]
    fn obligations_that_is_not_a_list_is_malformed_and_denies() {
        // Strict like `assist`: present-but-wrong-type is a body this client does
        // not understand, not a field to coerce away.
        for body in [
            r#"{"assist":"step_up","obligations":"webauthn"}"#,
            r#"{"assist":"allow","obligations":{"type":"webauthn"}}"#,
            r#"{"assist":"allow","obligations":1}"#,
            r#"{"assist":"allow","obligations":null}"#,
            r#"{"assist":"step_up","obligations":["webauthn",42]}"#,
        ] {
            let d = parse(200, Some(body));
            assert_eq!(d.assist, Assist::Deny, "{body}");
            assert!(
                d.explanation().contains("obligations"),
                "{}",
                d.explanation()
            );
        }
    }

    #[test]
    fn an_unknown_field_from_a_newer_server_does_not_break_an_older_client() {
        let d = parse(
            200,
            Some(r#"{"assist":"allow","decisionId":"dec_1","somethingAddedLater":{"a":1}}"#),
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
        let d = parse(200, Some(r#"{"assist":"allow","decisionId":"dec_1"}"#));
        assert_eq!(d.assist, Assist::Allow);
        assert!(d.reasons.is_empty());
    }

    #[test]
    fn reasons_that_are_not_a_list_of_strings_are_malformed_and_deny() {
        // Strict like obligations: a non-list, a null, or a non-string entry is a body
        // this client does not understand. It used to read as absent and let an allow
        // stand; it is never stringified either way.
        for body in [
            r#"{"assist":"allow","decisionId":"dec_1","reasons":"a string not an array"}"#,
            r#"{"assist":"allow","decisionId":"dec_1","reasons":null}"#,
            r#"{"assist":"allow","decisionId":"dec_1","reasons":[{"code":42},"real reason"]}"#,
        ] {
            let d = parse(200, Some(body));
            assert_eq!(d.assist, Assist::Deny, "{body}");
            assert!(d.explanation().contains("reasons"), "{}", d.explanation());
        }
    }

    #[test]
    fn blank_reasons_are_well_typed_and_dropped_from_display() {
        let d = parse(
            200,
            Some(r#"{"assist":"allow","decisionId":"dec_1","reasons":["real reason",""," "]}"#),
        );
        assert_eq!(d.assist, Assist::Allow);
        assert_eq!(d.reasons, vec!["real reason".to_string()]);
    }

    #[test]
    fn every_outcome_needs_a_usable_decision_id() {
        for body in [
            r#"{"assist":"allow"}"#,
            r#"{"assist":"allow","decisionId":null}"#,
            r#"{"assist":"allow","decisionId":"   "}"#,
            r#"{"assist":"allow","decisionId":42}"#,
            r#"{"assist":"step_up","reasons":["device posture is stale"]}"#,
            r#"{"assist":"restrict","reasons":["shared account"]}"#,
            r#"{"assist":"deny","reasons":["device is jailbroken"]}"#,
        ] {
            let d = parse(200, Some(body));
            assert_eq!(d.assist, Assist::Deny, "{body}");
            assert!(
                d.explanation().contains("decisionId"),
                "{}",
                d.explanation()
            );
            assert_eq!(d.decision_id, None, "{body}");
        }
    }

    #[test]
    fn a_repeated_top_level_key_denies_whatever_its_values() {
        for body in [
            r#"{"assist":"deny","assist":"allow","decisionId":"dec_1"}"#,
            r#"{"assist":"allow","assist":"allow","decisionId":"dec_1"}"#,
            r#"{"assist":"allow","assist":"allow","decisionId":"dec_1"}"#,
            r#"{"assist":"allow","decisionId":"dec_1","decisionId":"dec_2"}"#,
        ] {
            let d = parse(200, Some(body));
            assert_eq!(d.assist, Assist::Deny, "{body}");
            assert!(d.explanation().contains("duplicate"), "{}", d.explanation());
            assert_eq!(d.decision_id, None, "{body}");
        }
    }

    #[test]
    fn a_repeated_key_below_the_top_level_is_not_a_duplicate() {
        let d = parse(
            200,
            Some(r#"{"assist":"allow","decisionId":"dec_1","x":{"a":1,"a":2}}"#),
        );
        assert_eq!(d.assist, Assist::Allow);
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
