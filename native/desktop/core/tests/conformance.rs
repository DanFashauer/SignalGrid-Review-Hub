//! The shared Assist-wire conformance vectors, run against this client.
//!
//! WHY THIS EXISTS SEPARATELY FROM THE UNIT TESTS. There are now three independent
//! implementations of the same fail-closed rule — TypeScript in `lib/`, Kotlin in
//! `native/android/core`, and this. Each has its own hand-written unit tests, and
//! that is exactly the arrangement in which they can quietly diverge: every suite
//! stays green while one client starts treating `{"assist":true}` as something other
//! than a denial, because nobody wrote that case in that language.
//!
//! `native/shared/assist-wire-conformance.json` is one set of cases that every client
//! must agree on. Adding a case there obliges every client at once, which is the
//! whole point — a shared expectation nobody is forced to satisfy is a document, not
//! a gate.
//!
//! THE NON-VACUITY FLOOR. A suite made only of denials is satisfied by a client that
//! returns DENY unconditionally and decides nothing. So before the cases run, this
//! asserts the vector file contains all four outcomes and enough of them; and after,
//! it asserts a proceedable case actually proceeded. Both of those fail loudly if the
//! file is ever trimmed down to something toothless.

use serde_json::Value;
use signalgrid_assist_core::{parse_assist_response, Assist};
use std::path::PathBuf;

fn vectors_path() -> PathBuf {
    // CARGO_MANIFEST_DIR is native/desktop/core.
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../shared/assist-wire-conformance.json")
}

fn load() -> Value {
    let path = vectors_path();
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        // Not a skip. A missing vector file means this client is running against
        // nothing, and "no cases ran" must never look like "all cases passed".
        panic!("could not read the shared conformance vectors at {path:?}: {e}")
    });
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("{path:?} is not valid JSON: {e}"))
}

fn expected_assist(name: &str) -> Assist {
    match name {
        "allow" => Assist::Allow,
        "step_up" => Assist::StepUp,
        "restrict" => Assist::Restrict,
        "deny" => Assist::Deny,
        other => panic!("vector file names an outcome this client does not have: {other:?}"),
    }
}

#[test]
fn the_vector_file_is_not_vacuous() {
    let doc = load();
    let cases = doc["cases"].as_array().expect("cases must be an array");
    let requires = &doc["requires"];

    let min = requires["minCases"].as_u64().expect("requires.minCases") as usize;
    assert!(
        cases.len() >= min,
        "the vector file has {} cases but declares a floor of {min}; a suite that \
         shrinks below its own floor is a suite that stopped proving things",
        cases.len()
    );

    let present: Vec<String> = cases
        .iter()
        .map(|c| c["expect"].as_str().expect("expect").to_string())
        .collect();
    for outcome in requires["outcomesPresent"]
        .as_array()
        .expect("outcomesPresent")
    {
        let outcome = outcome.as_str().unwrap();
        assert!(
            present.iter().any(|p| p == outcome),
            "no case expects {outcome:?}. Without one, a client that answers the same \
             way to everything would pass this file."
        );
    }

    // The one that actually kills the trivial client.
    assert!(
        present.iter().any(|p| p == "allow"),
        "no case is expected to ALLOW, so a client hardcoded to DENY would pass"
    );

    let mut ids: Vec<&str> = cases.iter().map(|c| c["id"].as_str().unwrap()).collect();
    let before = ids.len();
    ids.sort_unstable();
    ids.dedup();
    assert_eq!(before, ids.len(), "duplicate case ids in the vector file");
}

#[test]
fn every_shared_case_agrees_with_this_client() {
    let doc = load();
    let cases = doc["cases"].as_array().unwrap();

    let mut failures: Vec<String> = Vec::new();
    let mut allowed = 0usize;

    for case in cases {
        let id = case["id"].as_str().unwrap();
        let why = case["why"].as_str().unwrap_or("");
        let status = case["status"].as_u64().unwrap() as u16;
        let body = case["body"].as_str();
        let expect = expected_assist(case["expect"].as_str().unwrap());

        let decision = parse_assist_response(status, body);
        if decision.assist != expect {
            failures.push(format!(
                "  {id}: expected {expect}, got {} — {why}",
                decision.assist
            ));
            continue;
        }
        // Assert the CONSEQUENCE, not just the label: an allow that does not actually
        // proceed would satisfy the outcome check while blocking every worker.
        //
        // COLLECTED, NOT ASSERTED IN PLACE. The Kotlin twin of this test panicked here
        // instead, which aborted its loop at the first disagreement and hid a second
        // one — it reported ONE divergence when there were two. A report that stops at
        // its first finding makes the rest invisible.
        let proceeds = decision.assist.proceeds_without_further_action();
        if expect == Assist::Allow {
            allowed += 1;
            if !proceeds {
                failures.push(format!(
                    "  {id}: an allow must proceed without further action"
                ));
            }
        } else if proceeds {
            failures.push(format!(
                "  {id}: {expect} must NOT proceed without further action"
            ));
        }

        // The obligations a client must have PARSED — the served shape declares none,
        // and "empty" is the assertion, not merely "still a step_up".
        if let Some(expected) = case.get("expectObligations").and_then(|v| v.as_array()) {
            let expected: Vec<&str> = expected.iter().map(|v| v.as_str().unwrap()).collect();
            if decision.obligations != expected {
                failures.push(format!(
                    "  {id}: obligations parsed as {:?}, expected {expected:?}",
                    decision.obligations
                ));
            }
        }

        if let Some(fragments) = case
            .get("expectExplanationContains")
            .and_then(|v| v.as_array())
        {
            let explanation = decision.explanation();
            for fragment in fragments {
                let fragment = fragment.as_str().unwrap();
                if !explanation.contains(fragment) {
                    failures.push(format!(
                        "  {id}: explanation {explanation:?} does not mention {fragment:?}"
                    ));
                }
            }
        }
    }

    assert!(
        failures.is_empty(),
        "{} shared conformance case(s) disagree with this client:\n{}",
        failures.len(),
        failures.join("\n")
    );
    // Re-asserted here rather than trusted from the other test: this is the run that
    // actually executed the client, so this is where "something proceeded" is real.
    assert!(
        allowed > 0,
        "no case reached ALLOW — this run proved only that things fail"
    );
    eprintln!(
        "{} shared conformance cases pass ({allowed} of them proceedable)",
        cases.len()
    );
}
