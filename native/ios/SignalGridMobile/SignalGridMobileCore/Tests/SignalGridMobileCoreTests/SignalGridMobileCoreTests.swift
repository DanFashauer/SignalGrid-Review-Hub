import XCTest
@testable import SignalGridMobileCore

final class SignalGridMobileCoreTests: XCTestCase {
    func testDeterministicScenarioOutcomes() async throws {
        let api = MockSignalGridAPI()

        for scenario in DemoFixtures.trustScenarios {
            let result = try await api.evaluate(
                EvaluateRequest(
                    identityRef: scenario.identityRef,
                    deviceRef: scenario.deviceRef,
                    workflowKey: scenario.workflowKey,
                    requestContext: ["test": scenario.id]
                )
            )
            XCTAssertEqual(result.outcome, scenario.expectedOutcome, scenario.title)
            XCTAssertFalse(result.reasonCodes.isEmpty)
            XCTAssertFalse(result.policyVersionId.isEmpty)
            XCTAssertFalse(result.evidenceSnapshotId.isEmpty)
        }
    }

    func testSessionLifecycle() async throws {
        let api = MockSignalGridAPI()
        let request = EvaluateRequest(
            identityRef: "nurse.compliant",
            deviceRef: "ipad-ward-01",
            workflowKey: "clinical-session"
        )

        let started = try await api.startSession(request, ttlSeconds: 900)
        XCTAssertEqual(started.session.status, .active)
        XCTAssertEqual(started.decision.outcome, .allow)

        let refreshed = try await api.refreshSession(id: started.session.id, ttlSeconds: 900)
        XCTAssertEqual(refreshed.status, .active)
        XCTAssertNotEqual(refreshed.lastSeenAt, started.session.lastSeenAt)

        let ended = try await api.endSession(id: started.session.id)
        XCTAssertEqual(ended.status, .ended)
    }

    func testAppWorkflowNeverAutoRunsSensitiveAction() async throws {
        let api = MockSignalGridAPI()
        let evaluation = try await api.evaluateAppWorkflow(
            AppWorkflowRequest(
                integrationId: "emr-chart",
                identityRef: "nurse.compliant",
                deviceRef: "ipad-ward-01"
            )
        )

        XCTAssertEqual(evaluation.decision.outcome, .allow)
        let sensitive = evaluation.plan.actions.filter(\.sensitive)
        XCTAssertFalse(sensitive.isEmpty)
        XCTAssertTrue(sensitive.allSatisfy { $0.disposition == .assist })
        XCTAssertTrue(sensitive.allSatisfy(\.requiresConfirmation))
    }

    func testStepUpHoldsGatedActions() async throws {
        let api = MockSignalGridAPI()
        let evaluation = try await api.evaluateAppWorkflow(
            AppWorkflowRequest(
                integrationId: "emr-chart",
                identityRef: "nurse.stale",
                deviceRef: "ipad-ward-03"
            )
        )

        XCTAssertEqual(evaluation.decision.outcome, .stepUp)
        XCTAssertTrue(
            evaluation.plan.actions
                .filter { $0.sensitive || $0.riskTier != .standard }
                .allSatisfy { $0.disposition == .stepUp }
        )
    }

    func testEvidenceMatchesDecision() async throws {
        let api = MockSignalGridAPI()
        let decision = try await api.fetchDecisions().first { $0.outcome == .deny }
        let unwrapped = try XCTUnwrap(decision)
        let evidence = try await api.fetchEvidence(decisionId: unwrapped.id)

        XCTAssertEqual(evidence.decisionId, unwrapped.id)
        XCTAssertEqual(evidence.policyVersionId, unwrapped.policyVersionId)
        XCTAssertFalse(evidence.signalsUsed.isEmpty)
        XCTAssertTrue(evidence.digest.hasPrefix("sha256:"))
    }

    func testPublicSafeFixtureMarkers() async throws {
        let api = MockSignalGridAPI()
        let connectors = try await api.fetchConnectors()

        XCTAssertTrue(connectors.allSatisfy { $0.mode == "fixture" })
        XCTAssertTrue(connectors.allSatisfy { $0.credentialRef.contains("placeholder") })
        XCTAssertTrue(connectors.allSatisfy { !$0.credentialRef.contains("secret=") })
    }

    // MARK: - /v1 contract fidelity (guards against Swift <-> API drift)

    /// The Review-Hub API wraps every /v1 payload as `{ requestId, timestamp, ...payload }`
    /// (artifacts/api-server/src/routes/v1.ts `envelope()`), spreading the payload fields
    /// as siblings of the metadata. The Swift client must extract the payload and tolerate
    /// the metadata. This mirrors the production envelope decode against that exact shape.
    func testDecodesRepoV1EnvelopeShape() async throws {
        let api = MockSignalGridAPI()
        let decisions = try await api.fetchDecisions()
        let decision = try XCTUnwrap(decisions.first)

        let payloadData = try JSONEncoder().encode(decision)
        let payloadObject = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: payloadData) as? [String: Any]
        )
        // Reproduce the real envelope: metadata siblings + the payload under its key.
        let envelopeObject: [String: Any] = [
            "requestId": "req-abc-123",
            "timestamp": "2026-07-24T00:00:00.000Z",
            "decision": payloadObject,
        ]
        let envelopeData = try JSONSerialization.data(withJSONObject: envelopeObject)

        struct DecisionEnvelope: Decodable { let decision: Decision }
        let decoded = try JSONDecoder().decode(DecisionEnvelope.self, from: envelopeData)

        XCTAssertEqual(decoded.decision.id, decision.id)
        XCTAssertEqual(decoded.decision.outcome, decision.outcome)
        XCTAssertEqual(decoded.decision.policyVersionId, decision.policyVersionId)
    }

    /// The decision-outcome vocabulary and the app-workflow disposition/mode wire values
    /// must match the repo's TypeScript contracts EXACTLY (@workspace/signalgrid-core and
    /// lib/app-workflows), including the Trust->Action `assist` outcome. A rename on either
    /// side that silently breaks decoding fails here.
    func testEnumWireValuesMatchRepoContract() {
        XCTAssertEqual(Set(DecisionOutcome.allCases.map(\.rawValue)), ["allow", "step_up", "restrict", "deny"])

        XCTAssertEqual(AppActionDisposition.auto.rawValue, "auto")
        XCTAssertEqual(AppActionDisposition.assist.rawValue, "assist")
        XCTAssertEqual(AppActionDisposition.stepUp.rawValue, "step_up")
        XCTAssertEqual(AppActionDisposition.blocked.rawValue, "blocked")
        XCTAssertEqual(AppActionDisposition.applied.rawValue, "applied")

        XCTAssertEqual(AppSessionMode.proceed.rawValue, "proceed")
        XCTAssertEqual(AppSessionMode.assist.rawValue, "assist")
        XCTAssertEqual(AppSessionMode.stepUp.rawValue, "step_up")
        XCTAssertEqual(AppSessionMode.hold.rawValue, "hold")
        XCTAssertEqual(AppSessionMode.deny.rawValue, "deny")
    }
}

// MARK: - Step-up gate
//
// The decision path is pure Swift so it is verified on every platform, including the
// Linux CI box that has no biometric hardware at all.

private struct StubAuthenticator: StepUpAuthenticating {
    let outcome: StepUpOutcome
    let recorder: Recorder

    final class Recorder: @unchecked Sendable {
        var reasons: [StepUpReason] = []
    }

    func challenge(reason: StepUpReason) async -> StepUpOutcome {
        recorder.reasons.append(reason)
        return outcome
    }
}

final class StepUpGateTests: XCTestCase {
    func testOnlyStepUpTriggersAChallenge() {
        XCTAssertTrue(StepUpGate.requiresChallenge(for: .stepUp))
        // A refusal is not a step-up. Challenging for one would imply the action becomes
        // available if the person authenticates, and it does not.
        XCTAssertFalse(StepUpGate.requiresChallenge(for: .allow))
        XCTAssertFalse(StepUpGate.requiresChallenge(for: .restrict))
        XCTAssertFalse(StepUpGate.requiresChallenge(for: .deny))
    }

    func testAllowNeverPromptsThePerson() async {
        let rec = StubAuthenticator.Recorder()
        let gate = StepUpGate(authenticator: StubAuthenticator(outcome: .satisfied, recorder: rec))
        let result = await gate.evaluate(outcome: .allow, reason: .posture)
        XCTAssertNil(result)
        XCTAssertTrue(rec.reasons.isEmpty, "an allow verdict must not interrupt the clinician")
        XCTAssertTrue(StepUpGate.permits(result))
    }

    func testSatisfiedChallengePermitsTheAction() async {
        let rec = StubAuthenticator.Recorder()
        let gate = StepUpGate(authenticator: StubAuthenticator(outcome: .satisfied, recorder: rec))
        let result = await gate.evaluate(outcome: .stepUp, reason: .custody)
        XCTAssertEqual(result, .satisfied)
        XCTAssertEqual(rec.reasons, [.custody])
        XCTAssertTrue(StepUpGate.permits(result))
    }

    func testRefusedChallengeWithholdsTheAction() async {
        let gate = StepUpGate(authenticator: StubAuthenticator(outcome: .refused("cancelled"), recorder: .init()))
        let result = await gate.evaluate(outcome: .stepUp, reason: .privilegedAction)
        XCTAssertFalse(StepUpGate.permits(result))
    }

    func testUnavailableAuthenticatorIsNotAFreePass() async {
        // "We could not ask" is not "they answered". A device with no biometric
        // hardware must not be more permissive than one that asked and was refused —
        // the same discipline the server-side connectors apply to an unreadable signal.
        let gate = StepUpGate(authenticator: StubAuthenticator(outcome: .unavailable("no hardware"), recorder: .init()))
        let result = await gate.evaluate(outcome: .stepUp, reason: .staleSession)
        XCTAssertFalse(StepUpGate.permits(result))
    }

    func testEveryReasonCarriesASpecificPrompt() {
        // A vague prompt teaches people to approve reflexively, which defeats the
        // control. Each reason must say what actually changed.
        let reasons: [StepUpReason] = [.posture, .custody, .privilegedAction, .staleSession]
        for reason in reasons {
            XCTAssertTrue(reason.localizedReason.contains("Confirm it's you"))
            XCTAssertGreaterThan(reason.localizedReason.count, 30, "\(reason) prompt is too vague to be meaningful")
        }
        XCTAssertEqual(Set(reasons.map(\.localizedReason)).count, reasons.count, "prompts must be distinguishable")
    }
}
