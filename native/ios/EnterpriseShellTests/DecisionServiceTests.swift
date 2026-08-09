import XCTest

// In Xcode these sources are compiled directly into the test bundle (see
// `EnterpriseShellTests` in ../project.yml), so there is no module to import. Under
// SwiftPM (../Package.swift) the same files are a library, and this brings it in.
// `canImport` keeps one set of tests serving both, with no #if around the tests
// themselves — a divergence there is how two builds start proving different things.
#if canImport(EnterpriseShellPort)
@testable import EnterpriseShellPort
#endif

/// A URLProtocol stub so the remote client can be tested against the real API
/// contract without a live server (the api-server build is linux-only, so it
/// can't run here — this verifies request encoding + response mapping instead).
final class StubURLProtocol: URLProtocol {
    /// (statusCode, body) to return, and a captured request for assertions.
    static var responder: ((URLRequest) -> (Int, Data))?
    static var lastRequest: URLRequest?
    static var lastBody: Data?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        StubURLProtocol.lastRequest = request
        // URLProtocol strips httpBody into httpBodyStream; read it back for assertions.
        if let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            let bufSize = 1024
            let buf = UnsafeMutablePointer<UInt8>.allocate(capacity: bufSize)
            defer { buf.deallocate() }
            while stream.hasBytesAvailable {
                let read = stream.read(buf, maxLength: bufSize)
                if read <= 0 { break }
                data.append(buf, count: read)
            }
            stream.close()
            StubURLProtocol.lastBody = data
        } else {
            StubURLProtocol.lastBody = request.httpBody
        }

        let (status, body) = StubURLProtocol.responder?(request) ?? (200, Data())
        let response = HTTPURLResponse(url: request.url!, statusCode: status,
                                       httpVersion: "HTTP/1.1", headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class DecisionServiceTests: XCTestCase {

    private func stubbedSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        return URLSession(configuration: config)
    }

    private func request(_ signals: [DecisionEngine.Signal] = [.authenticated, .postureObserved]) -> AppDecisionRequest {
        AppDecisionRequest(integrationId: "emr-chart", identityRef: "nurse-01",
                           deviceRef: "ipad-4b", localSignals: signals)
    }

    override func setUp() {
        super.setUp()
        StubURLProtocol.responder = nil
        StubURLProtocol.lastRequest = nil
        StubURLProtocol.lastBody = nil
    }

    // The on-device service matches the engine directly.
    func testLocalServiceMatchesEngine() async throws {
        let r = try await LocalDecisionService().evaluate(request([.authenticated, .postureObserved, .staleCheckin]))
        XCTAssertEqual(r.outcome, .step_up)
        XCTAssertTrue(r.reasonCodes.contains("POSTURE_STALE"))
        XCTAssertEqual(r.source, .onDevice)
    }

    // Remote request is encoded correctly: method, path, bearer, JSON body.
    func testRemoteEncodesRequest() async throws {
        StubURLProtocol.responder = { _ in
            (200, #"{"decision":{"outcome":"allow","reasonCodes":["IDENTITY_AND_POSTURE_TRUSTED"]},"plan":{"outcome":"allow","mode":"proceed"}}"#.data(using: .utf8)!)
        }
        let svc = RemoteDecisionService(baseURL: URL(string: "https://cp.example")!,
                                        bearerToken: "tok-123", session: stubbedSession())
        _ = try await svc.evaluate(request())

        let req = try XCTUnwrap(StubURLProtocol.lastRequest)
        XCTAssertEqual(req.httpMethod, "POST")
        // The Express api-server mounts /v1 under /api, so the encoded path must
        // carry the /api prefix (4b576a5 decision-path correction) — the bare
        // /v1/... path would 404 against the real server.
        XCTAssertEqual(req.url?.path, "/api/v1/app-workflows/evaluate")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Authorization"), "Bearer tok-123")
        XCTAssertEqual(req.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let body = try XCTUnwrap(StubURLProtocol.lastBody)
        let json = try XCTUnwrap(try JSONSerialization.jsonObject(with: body) as? [String: String])
        XCTAssertEqual(json["integrationId"], "emr-chart")
        XCTAssertEqual(json["identityRef"], "nurse-01")
        XCTAssertEqual(json["deviceRef"], "ipad-4b")
    }

    // Remote maps the plan's decided outcome + reason codes; source is control-plane.
    func testRemoteMapsDecidedOutcome() async throws {
        StubURLProtocol.responder = { _ in
            (200, #"{"decision":{"outcome":"step_up","reasonCodes":["POSTURE_STALE","SHARED_DEVICE"],"explanation":"held"},"plan":{"outcome":"step_up","mode":"step_up"}}"#.data(using: .utf8)!)
        }
        let svc = RemoteDecisionService(baseURL: URL(string: "https://cp.example")!,
                                        bearerToken: "t", session: stubbedSession())
        let r = try await svc.evaluate(request())
        XCTAssertEqual(r.outcome, .step_up)
        XCTAssertEqual(r.reasonCodes, ["POSTURE_STALE", "SHARED_DEVICE"])
        XCTAssertEqual(r.source, .controlPlane)
    }

    // A non-2xx response surfaces as an http error.
    func testRemoteHttpErrorThrows() async {
        StubURLProtocol.responder = { _ in (403, Data()) }
        let svc = RemoteDecisionService(baseURL: URL(string: "https://cp.example")!,
                                        bearerToken: "t", session: stubbedSession())
        do {
            _ = try await svc.evaluate(request())
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? DecisionServiceError, .http(403))
        }
    }

    // An unrecognized outcome fails closed (thrown), never silently allows. The
    // error carries BOTH raw fields (decision/plan) since both must parse.
    func testRemoteUnknownOutcomeThrows() async {
        StubURLProtocol.responder = { _ in
            (200, #"{"decision":{"outcome":"banana","reasonCodes":[]},"plan":{"outcome":"banana"}}"#.data(using: .utf8)!)
        }
        let svc = RemoteDecisionService(baseURL: URL(string: "https://cp.example")!,
                                        bearerToken: "t", session: stubbedSession())
        do {
            _ = try await svc.evaluate(request())
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? DecisionServiceError, .unknownOutcome("banana/banana"))
        }
    }

    // A malformed decision outcome alongside a parseable plan "allow" must
    // invalidate the whole envelope — never fall through to the permissive field.
    func testRemotePartiallyUnknownOutcomeThrows() async {
        StubURLProtocol.responder = { _ in
            (200, #"{"decision":{"outcome":"banana","reasonCodes":[]},"plan":{"outcome":"allow"}}"#.data(using: .utf8)!)
        }
        let svc = RemoteDecisionService(baseURL: URL(string: "https://cp.example")!,
                                        bearerToken: "t", session: stubbedSession())
        do {
            _ = try await svc.evaluate(request())
            XCTFail("expected an error")
        } catch {
            XCTAssertEqual(error as? DecisionServiceError, .unknownOutcome("banana/allow"))
        }
    }

    // A remote failure falls back to the on-device engine (device keeps working).
    func testFallbackToOnDeviceOnError() async {
        StubURLProtocol.responder = { _ in (500, Data()) }
        let svc = RemoteDecisionService(baseURL: URL(string: "https://cp.example")!,
                                        bearerToken: "t", session: stubbedSession())
        let r = await DecisionServiceProvider.evaluateWithFallback(
            svc, request([.authenticated, .postureObserved, .nonCompliant]))
        XCTAssertEqual(r.source, .onDevice)
        XCTAssertEqual(r.outcome, .restrict) // computed on-device
    }

    // Provider selects control-plane only when both URL and token are present.
    func testProviderSelection() {
        XCTAssertTrue(DecisionServiceProvider.resolve(backendURL: nil, bearerToken: "t") is LocalDecisionService)
        XCTAssertTrue(DecisionServiceProvider.resolve(backendURL: URL(string: "https://x")!, bearerToken: "") is LocalDecisionService)
        XCTAssertTrue(DecisionServiceProvider.resolve(backendURL: URL(string: "https://x")!, bearerToken: "t") is RemoteDecisionService)
    }
}
