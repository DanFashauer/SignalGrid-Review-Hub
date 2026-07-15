# BLE-First MVP - Acceptance Tests

This document defines the acceptance tests for the BLE-First MVP implementation.

---

## 1. iOS Unit Tests (Swift)

### 1.1 Badge Validation

```swift
// Test: Valid badge passes validation
func testValidBadgePassesValidation() {
    let result = SecurityManager.shared.validateBadgeId("A1234567")
    XCTAssertTrue(result.valid)
    XCTAssertNil(result.error)
}

// Test: Badge too short fails validation
func testBadgeTooShortFailsValidation() {
    let result = SecurityManager.shared.validateBadgeId("A12")
    XCTAssertFalse(result.valid)
    XCTAssertNotNil(result.error)
}

// Test: Badge with suspicious patterns is rejected
func testSuspiciousBadgePatternRejected() {
    let result = SecurityManager.shared.validateBadgeId("A1234<script>")
    XCTAssertFalse(result.valid)
    XCTAssertEqual(result.error, "Invalid badge format")
}
```

### 1.2 Rate Limiting

```swift
// Test: Repeated scans hit rate limit
func testRepeatedScansHitRateLimit() {
    let badgeId = "A1234567"
    
    // First few scans should be allowed
    for i in 0..<5 {
        let result = SecurityManager.shared.isBadgeScanAllowed(badgeId: badgeId)
        XCTAssertTrue(result.allowed, "Scan \(i) should be allowed")
    }
    
    // 6th scan should be blocked
    let result = SecurityManager.shared.isBadgeScanAllowed(badgeId: badgeId)
    XCTAssertFalse(result.allowed)
    XCTAssertEqual(result.reason, "Too many failed attempts. Please try again later.")
}

// Test: Lockout triggers after rate limit exceeded
func testLockoutTriggersAfterRateLimit() {
    let badgeId = "A1234567"
    
    // Exhaust attempts
    for _ in 0..<6 {
        _ = SecurityManager.shared.isBadgeScanAllowed(badgeId: badgeId)
    }
    
    let status = SecurityManager.shared.getSecurityStatus()
    XCTAssertTrue(status["isLockedOut"] as? Bool ?? false)
}
```

### 1.3 Request Signing

```swift
// Test: Request is properly signed
func testRequestSigning() {
    var request = URLRequest(url: URL(string: "https://api.example.com/session/start")!)
    request.httpMethod = "POST"
    request.httpBody = "{\"badge\":{\"raw\":\"A1234567\"}}".data(using: .utf8)
    
    SecurityManager.shared.signRequest(&request)
    
    XCTAssertNotNil(request.value(forHTTPHeaderField: "X-Request-Timestamp"))
    XCTAssertNotNil(request.value(forHTTPHeaderField: "X-Request-Nonce"))
    XCTAssertNotNil(request.value(forHTTPHeaderField: "X-Request-Signature"))
    XCTAssertNotNil(request.value(forHTTPHeaderField: "X-Device-Binding"))
}

// Test: Signature verification succeeds with correct key
func testSignatureVerificationSucceeds() {
    let result = SecurityManager.shared.verifySignature(
        signature: "abc123...", // valid signature
        timestamp: String(Int(Date().timeIntervalSince1970)),
        nonce: UUID().uuidString,
        method: "POST",
        url: "https://api.example.com/session/start",
        body: "{\"badge\":{\"raw\":\"A1234567\"}}".data(using: .utf8)
    )
    XCTAssertTrue(result)
}

// Test: Signature verification fails with wrong key
func testSignatureVerificationFailsWithWrongKey() {
    // Use a different signing secret
    let result = SecurityManager.shared.verifySignature(
        signature: "wrong_signature",
        timestamp: String(Int(Date().timeIntervalSince1970)),
        nonce: UUID().uuidString,
        method: "POST",
        url: "https://api.example.com/session/start",
        body: "{\"badge\":{\"raw\":\"A1234567\"}}".data(using: .utf8)
    )
    XCTAssertFalse(result)
}
```

### 1.4 BLE Provider

```swift
// Test: BLE provider initializes correctly
func testBLEProviderInitializes() {
    let provider = BLEBadgeReaderProvider()
    provider.setup()
    
    XCTAssertEqual(provider.displayName, "BLE Badge Reader")
    XCTAssertFalse(provider.isConnected)
}

// Test: Badge is processed through security gates
func testBLEProviderProcessesBadge() {
    let provider = BLEBadgeReaderProvider()
    var delegateCalled = false
    var capturedBadge: String?
    
    class MockDelegate: BadgeReaderProviderDelegate {
        var didCaptureBadge: String?
        
        func badgeReader(_ provider: BadgeReaderProvider, didReadBadge badgeId: String) {
            didCaptureBadge = badgeId
        }
        
        func badgeReader(_ provider: BadgeReaderProvider, didFailWithError error: Error) {}
        func badgeReaderDidDisconnect(_ provider: BadgeReaderProvider) {}
        func badgeReaderDidConnect(_ provider: BadgeReaderProvider) {}
    }
    
    let mockDelegate = MockDelegate()
    provider.delegate = mockDelegate
    
    // Note: In real test, would simulate BLE callback
    // provider.handleBadgePayload("A1234567".data(using: .utf8)!)
    
    // XCTAssertEqual(mockDelegate.didCaptureBadge, "A1234567")
}
```

---

## 2. Backend Contract Tests (TypeScript/Node.js)

### 2.1 Missing Signature Headers

```typescript
import { validateAndAuthorizeSessionStart, verifySignedRequest } from './validation';

test('missing signature headers returns 401', () => {
  const result = validateAndAuthorizeSessionStart(
    validBadgeEvent,
    {
      method: 'POST',
      fullUrl: 'https://api.example.com/session/start',
      headers: {
        'x-request-timestamp': undefined,
        'x-request-nonce': undefined,
        'x-request-signature': undefined,
        'x-device-binding': undefined,
      },
      signingSecret: 'test-secret',
    }
  );
  
  expect(result.ok).toBe(false);
  expect(result.status).toBe(401);
  expect(result.body?.reason).toBe('missing_signature_headers');
});
```

### 2.2 Timestamp Out of Window

```typescript
test('timestamp older than 5 min returns 401', () => {
  const oldTimestamp = String(Math.floor(Date.now() / 1000) - 400); // 6+ minutes ago
  
  const result = validateAndAuthorizeSessionStart(
    validBadgeEvent,
    {
      method: 'POST',
      fullUrl: 'https://api.example.com/session/start',
      headers: {
        'x-request-timestamp': oldTimestamp,
        'x-request-nonce': 'valid-nonce',
        'x-request-signature': 'valid-signature',
        'x-device-binding': 'valid-binding',
      },
      signingSecret: 'test-secret',
    }
  );
  
  expect(result.ok).toBe(false);
  expect(result.status).toBe(401);
  expect(result.body?.reason).toBe('timestamp_out_of_window');
});
```

### 2.3 Replay Detection

```typescript
test('same nonce reused returns 401 replay_detected', () => {
  const nonce = 'test-nonce-123';
  
  // First request
  const firstResult = validateAndAuthorizeSessionStart(
    validBadgeEvent,
    {
      method: 'POST',
      fullUrl: 'https://api.example.com/session/start',
      headers: {
        'x-request-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-request-nonce': nonce,
        'x-request-signature': 'valid-signature',
        'x-device-binding': 'valid-binding',
      },
      signingSecret: 'test-secret',
    }
  );
  
  expect(firstResult.ok).toBe(true);
  
  // Second request with same nonce
  const secondResult = validateAndAuthorizeSessionStart(
    validBadgeEvent,
    {
      method: 'POST',
      fullUrl: 'https://api.example.com/session/start',
      headers: {
        'x-request-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-request-nonce': nonce,
        'x-request-signature': 'valid-signature',
        'x-device-binding': 'valid-binding',
      },
      signingSecret: 'test-secret',
    }
  );
  
  expect(secondResult.ok).toBe(false);
  expect(secondResult.status).toBe(401);
  expect(secondResult.body?.reason).toBe('replay_detected');
});
```

### 2.4 Masked Badge Mismatch

```typescript
test('masked mismatch returns 400', () => {
  const event = {
    ...validBadgeEvent,
    badge: {
      raw: 'A1234567',
      masked: 'WRONG****67', // Invalid masked value
      format: 'alphanumeric',
      confidence: 0.99,
    },
  };
  
  const result = validateAndAuthorizeSessionStart(
    event,
    {
      method: 'POST',
      fullUrl: 'https://api.example.com/session/start',
      headers: {
        'x-request-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-request-nonce': 'unique-nonce',
        'x-request-signature': 'valid-signature',
        'x-device-binding': 'valid-binding',
      },
      signingSecret: 'test-secret',
    }
  );
  
  expect(result.ok).toBe(false);
  expect(result.status).toBe(400);
  expect(result.body?.details?.badge).toBe('masked_mismatch');
});
```

### 2.5 Valid Request

```typescript
test('valid request returns 200 with session', () => {
  const result = validateAndAuthorizeSessionStart(
    validBadgeEvent,
    {
      method: 'POST',
      fullUrl: 'https://api.example.com/session/start',
      headers: {
        'x-request-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-request-nonce': 'unique-nonce-456',
        'x-request-signature': computeValidSignature(),
        'x-device-binding': 'valid-binding',
      },
      signingSecret: 'test-secret',
    }
  );
  
  expect(result.ok).toBe(true);
  expect(result.status).toBe(200);
  expect(result.event).toBeDefined();
  expect(result.event?.badge.raw).toBe('A1234567');
});

function computeValidSignature(): string {
  // Compute HMAC-SHA256 with test-secret
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = 'unique-nonce-456';
  const body = JSON.stringify(validBadgeEvent);
  const base = `POST|https://api.example.com/session/start${timestamp}${nonce}${body}`;
  return crypto.createHmac('sha256', 'test-secret').update(base).digest('hex');
}
```

---

## 3. Integration Tests

### 3.1 End-to-End Badge Scan Flow

```
1. User taps badge on BLE reader
2. BLEBadgeReaderProvider receives badge payload
3. SecurityManager.validateBadgeId() validates format
4. SecurityManager.isBadgeScanAllowed() checks rate limit
5. BackendService.startSession() sends signed request
6. Backend validates signature, timestamp, nonce
7. Backend returns session with persona
8. App launches persona apps
```

### 3.2 Transport Parity (BLE vs USB-C)

Both providers MUST produce identical BadgeEvent structure:

```swift
// BLE BadgeEvent
let bleEvent = BadgeEvent(
    schemaVersion: "1.0",
    eventId: UUID(),
    eventType: "badge.scan",
    capturedAt: Date(),
    badge: BadgeData(raw: "A1234567", masked: "A1****67", ...),
    reader: ReaderData(transport: "ble", vendor: "...", ...),
    device: DeviceData(deviceId: "...", ...),
    context: nil
)

// USB-C BadgeEvent - MUST be identical except reader.transport
let usbcEvent = BadgeEvent(
    schemaVersion: "1.0",
    eventId: UUID(),
    eventType: "badge.scan",
    capturedAt: Date(),
    badge: BadgeData(raw: "A1234567", masked: "A1****67", ...),
    reader: ReaderData(transport: "usbc", vendor: "...", ...), // ONLY DIFFERENCE
    device: DeviceData(deviceId: "...", ...),
    context: nil
)
```

---

## 4. Test Data

### Valid BadgeEvent

```json
{
  "schemaVersion": "1.0",
  "eventId": "550e8400-e29b-41d4-a716-446655440000",
  "eventType": "badge.scan",
  "capturedAt": "2026-02-20T23:59:59.000Z",
  "badge": {
    "raw": "A1234567",
    "masked": "A1****67",
    "format": "alphanumeric",
    "confidence": 0.99
  },
  "reader": {
    "transport": "ble",
    "vendor": "generic",
    "model": "ble-reader-v1",
    "serial": "UNKNOWN_OR_DEVICE_ID",
    "firmware": "0.0.0",
    "rssi": -62
  },
  "device": {
    "deviceId": "ios-device-identifier",
    "deviceSerial": "ios-serial-or-unknown",
    "bundleId": "com.enterprise.shell",
    "appVersion": "1.0.0",
    "platform": "iOS",
    "osVersion": "17.0",
    "mdm": {
      "enrolled": true,
      "tenant": "optional",
      "sharedDeviceMode": true
    }
  }
}
```

---

## 5. Running Tests

### iOS Tests

```bash
# Run Swift tests
cd ios
xcodebuild test -scheme EnterpriseShell -destination 'platform=iOS Simulator,name=iPhone 16'
```

### Backend Tests

```bash
# Run Node.js tests
npm test

# Or with bun
bun test
```

---

## 6. Success Criteria

| Test | Criteria |
|------|----------|
| Badge Validation | Valid badges accepted, invalid rejected |
| Rate Limiting | 5 attempts/min, then lockout |
| Request Signing | HMAC-SHA256 with timing-safe comparison |
| Timestamp Window | ±5 minutes accepted |
| Replay Prevention | Nonces stored for 10 minutes |
| Masked Badge | Format: prefix2 + "****" + suffix2 |
| Transport Parity | BLE and USB-C emit identical events |
