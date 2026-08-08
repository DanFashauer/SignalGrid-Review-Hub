//! What the Assist gate is allowed to say, and what a caller may conclude from it.
//!
//! This is the third implementation of this vocabulary — TypeScript is the source,
//! `native/android/core` has the Kotlin one, and this is Rust for the desktop shell.
//! Three implementations of a fail-closed rule is three chances to get it subtly
//! wrong in one of them, which is why `tests/conformance.rs` runs this and the Kotlin
//! client against ONE shared set of cases rather than against parallel hand-written
//! suites that can drift apart while both stay green.

use std::fmt;

/// The four outcomes. There is no fifth, and there is deliberately no "unknown":
/// something that cannot be classified is a DENY, decided at the parse boundary.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Assist {
    Allow,
    StepUp,
    Restrict,
    Deny,
}

impl Assist {
    /// Read an outcome off the wire.
    ///
    /// * `None` — the field was absent. The caller decides what that means; here it
    ///   is genuinely "nothing was said".
    /// * `Some(Deny)` — the field was present and this build does not recognise it.
    ///
    /// The asymmetry is the point. A newer server answering `allow_with_conditions`
    /// is telling an older client about a restriction it cannot enforce, so the only
    /// safe reading is DENY — never "close enough to allow".
    pub fn parse(raw: Option<&str>) -> Option<Assist> {
        let raw = raw?;
        Some(match raw.trim().to_ascii_lowercase().as_str() {
            "allow" => Assist::Allow,
            "step_up" => Assist::StepUp,
            "restrict" => Assist::Restrict,
            "deny" => Assist::Deny,
            _ => Assist::Deny,
        })
    }

    /// Whether the host app may carry on with no further action.
    ///
    /// ONLY `Allow`. `StepUp` is the one that invites a bug: it is not a refusal, so
    /// it reads as permission, but the worker has not answered the challenge yet.
    /// Treating it as proceedable is how a step-up becomes decorative.
    pub fn proceeds_without_further_action(self) -> bool {
        matches!(self, Assist::Allow)
    }

    pub fn wire_name(self) -> &'static str {
        match self {
            Assist::Allow => "allow",
            Assist::StepUp => "step_up",
            Assist::Restrict => "restrict",
            Assist::Deny => "deny",
        }
    }
}

impl fmt::Display for Assist {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.wire_name())
    }
}

/// A decision, plus whatever the gate said about it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssistDecision {
    pub assist: Assist,
    pub reasons: Vec<String>,
    pub obligations: Vec<String>,
    pub decision_id: Option<String>,
}

impl AssistDecision {
    pub fn denied(reason: impl Into<String>) -> Self {
        AssistDecision {
            assist: Assist::Deny,
            reasons: vec![reason.into()],
            obligations: Vec::new(),
            decision_id: None,
        }
    }

    /// Something a human can read.
    ///
    /// Reports the ABSENCE of reasons rather than rendering an empty string. A denial
    /// shown to a worker with no explanation is indistinguishable from a bug in the
    /// UI, and saying "no reason given" at least tells them which of the two it is.
    pub fn explanation(&self) -> String {
        if self.reasons.is_empty() {
            format!("{} (no reason given)", self.assist)
        } else {
            format!("{}: {}", self.assist, self.reasons.join("; "))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_values_parse() {
        assert_eq!(Assist::parse(Some("allow")), Some(Assist::Allow));
        assert_eq!(Assist::parse(Some("step_up")), Some(Assist::StepUp));
        assert_eq!(Assist::parse(Some("restrict")), Some(Assist::Restrict));
        assert_eq!(Assist::parse(Some("deny")), Some(Assist::Deny));
    }

    #[test]
    fn casing_and_surrounding_space_are_tolerated() {
        assert_eq!(Assist::parse(Some("  ALLOW ")), Some(Assist::Allow));
        assert_eq!(Assist::parse(Some("Step_Up")), Some(Assist::StepUp));
    }

    #[test]
    fn an_unrecognised_value_denies_rather_than_being_ignored() {
        assert_eq!(
            Assist::parse(Some("allow_with_conditions")),
            Some(Assist::Deny)
        );
        assert_eq!(Assist::parse(Some("")), Some(Assist::Deny));
        assert_eq!(Assist::parse(Some("null")), Some(Assist::Deny));
        // The near-miss that matters: a value that merely CONTAINS "allow".
        assert_eq!(Assist::parse(Some("disallow")), Some(Assist::Deny));
        assert_eq!(Assist::parse(Some("allow_all")), Some(Assist::Deny));
    }

    #[test]
    fn absence_is_distinguishable_from_an_unreadable_value() {
        assert_eq!(Assist::parse(None), None);
    }

    #[test]
    fn only_allow_proceeds() {
        assert!(Assist::Allow.proceeds_without_further_action());
        assert!(!Assist::StepUp.proceeds_without_further_action());
        assert!(!Assist::Restrict.proceeds_without_further_action());
        assert!(!Assist::Deny.proceeds_without_further_action());
    }

    #[test]
    fn an_explanation_reports_the_absence_of_reasons() {
        let d = AssistDecision {
            assist: Assist::Deny,
            reasons: Vec::new(),
            obligations: Vec::new(),
            decision_id: None,
        };
        assert!(
            d.explanation().contains("no reason given"),
            "{}",
            d.explanation()
        );
    }
}
