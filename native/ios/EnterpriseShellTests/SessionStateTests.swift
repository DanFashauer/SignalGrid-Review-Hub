import XCTest

// In Xcode these sources are compiled directly into the test bundle (see
// `EnterpriseShellTests` in ../project.yml), so there is no module to import. Under
// SwiftPM (../Package.swift) the same files are a library, and this brings it in.
// `canImport` keeps one set of tests serving both, with no #if around the tests
// themselves — a divergence there is how two builds start proving different things.
#if canImport(EnterpriseShellPort)
@testable import EnterpriseShellPort
#endif

/// Locks the session state-machine's safety invariants. SessionStateManager
/// enforces `allowedTransitions` (rejecting illegal jumps, fail-closed); these
/// tests guard the table itself so a future edit can't silently open a bypass —
/// e.g. letting a locked device jump straight into an active session.
final class SessionStateTests: XCTestCase {

    // A locked device can never jump straight to an active session.
    func testNoDirectLockedToActive() {
        XCTAssertFalse(SessionState.lockedIdle.allowedTransitions.contains(.activeSession))
    }

    // The ONLY way into an active session is through provisioning.
    func testOnlyProvisioningReachesActiveSession() {
        for state in SessionState.allCases where state != .provisioning {
            XCTAssertFalse(state.allowedTransitions.contains(.activeSession),
                           "\(state) must not transition directly to activeSession")
        }
        XCTAssertTrue(SessionState.provisioning.allowedTransitions.contains(.activeSession))
    }

    // Terminating can only return to the locked idle state.
    func testTerminatingOnlyToLocked() {
        XCTAssertEqual(SessionState.terminating.allowedTransitions, [.lockedIdle])
    }

    // An active session cannot silently re-enter auth/provisioning/badge states.
    func testActiveSessionCannotReenterEarlierStates() {
        let allowed = SessionState.activeSession.allowedTransitions
        for forbidden: SessionState in [.authenticating, .provisioning, .badgeCaptured, .enrolling] {
            XCTAssertFalse(allowed.contains(forbidden),
                           "activeSession must not transition back to \(forbidden)")
        }
        XCTAssertEqual(Set(allowed), Set([.terminating, .lockedIdle]))
    }

    // No state may transition to itself (no silent self-loops).
    func testNoSelfTransitions() {
        for state in SessionState.allCases {
            XCTAssertFalse(state.allowedTransitions.contains(state), "\(state) self-loop")
        }
    }

    // Every non-locked state can always fall back to locked (fail-safe lock).
    func testEveryStateCanLock() {
        for state in SessionState.allCases where state != .lockedIdle {
            XCTAssertTrue(state.allowedTransitions.contains(.lockedIdle),
                          "\(state) must be able to return to lockedIdle")
        }
    }

    // activeSession is the one and only authenticated state.
    func testActiveSessionIsTheOnlyAuthenticatedState() {
        for state in SessionState.allCases {
            XCTAssertEqual(state.isAuthenticated, state == .activeSession, "\(state)")
        }
    }

    // Every transition target is a real, reachable state (no dangling targets).
    func testAllTransitionTargetsAreValidStates() {
        let all = Set(SessionState.allCases)
        for state in SessionState.allCases {
            for target in state.allowedTransitions {
                XCTAssertTrue(all.contains(target), "\(state) → \(target) is not a valid state")
            }
        }
    }
}
