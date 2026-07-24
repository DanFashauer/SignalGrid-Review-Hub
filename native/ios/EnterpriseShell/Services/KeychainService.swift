import Foundation
import Security

/// Service for secure storage of authentication tokens using iOS Keychain
final class KeychainService {
    
    // MARK: - Singleton
    
    static let shared = KeychainService()
    
    // MARK: - Constants
    
    private let serviceName = "com.enterprise.shell"
    private let accessGroup: String? = nil // Set to app group if needed
    
    private enum KeychainKeys {
        static let accessToken = "access_token"
        static let refreshToken = "refresh_token"
        static let idToken = "id_token"
        static let sessionData = "session_data"
        static let deviceIdentifier = "device_identifier"
    }
    
    // MARK: - Initialization
    
    private init() {}
    
    // MARK: - Generic Keychain Operations
    
    /// Save data to Keychain
    func save(_ data: Data, forKey key: String) throws {
        // Delete existing item first
        delete(forKey: key)
        
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key,
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        ]

        // Add access group if configured
        if let group = accessGroup {
            query[kSecAttrAccessGroup as String] = group
        }

        let status = SecItemAdd(query as CFDictionary, nil)
        
        guard status == errSecSuccess else {
            throw KeychainError.saveFailed(status)
        }
    }
    
    /// Retrieve data from Keychain
    func retrieve(forKey key: String) throws -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        
        // Add access group if configured
        var resultQuery = query
        if let group = accessGroup {
            resultQuery[kSecAttrAccessGroup as String] = group
        }
        
        var result: AnyObject?
        let status = SecItemCopyMatching(resultQuery as CFDictionary, &result)
        
        guard status == errSecSuccess else {
            if status == errSecItemNotFound {
                return nil
            }
            throw KeychainError.retrieveFailed(status)
        }
        
        return result as? Data
    }
    
    /// Delete item from Keychain
    func delete(forKey key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key
        ]
        
        // Add access group if configured
        var resultQuery = query
        if let group = accessGroup {
            resultQuery[kSecAttrAccessGroup as String] = group
        }
        
        SecItemDelete(resultQuery as CFDictionary)
    }
    
    /// Check if item exists in Keychain
    func exists(forKey key: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key,
            kSecReturnData as String: false
        ]
        
        var resultQuery = query
        if let group = accessGroup {
            resultQuery[kSecAttrAccessGroup as String] = group
        }
        
        let status = SecItemCopyMatching(resultQuery as CFDictionary, nil)
        return status == errSecSuccess
    }
    
    // MARK: - Session Token Operations
    
    /// Save all session tokens
    func saveTokens(accessToken: String, refreshToken: String?, idToken: String?) throws {
        if let accessData = accessToken.data(using: .utf8) {
            try save(accessData, forKey: KeychainKeys.accessToken)
        }
        
        if let refreshToken = refreshToken,
           let refreshData = refreshToken.data(using: .utf8) {
            try save(refreshData, forKey: KeychainKeys.refreshToken)
        }
        
        if let idToken = idToken,
           let idData = idToken.data(using: .utf8) {
            try save(idData, forKey: KeychainKeys.idToken)
        }
    }
    
    /// Retrieve access token
    func getAccessToken() -> String? {
        guard let data = try? retrieve(forKey: KeychainKeys.accessToken),
              let token = String(data: data, encoding: .utf8) else {
            return nil
        }
        return token
    }
    
    /// Retrieve refresh token
    func getRefreshToken() -> String? {
        guard let data = try? retrieve(forKey: KeychainKeys.refreshToken),
              let token = String(data: data, encoding: .utf8) else {
            return nil
        }
        return token
    }
    
    /// Retrieve ID token
    func getIdToken() -> String? {
        guard let data = try? retrieve(forKey: KeychainKeys.idToken),
              let token = String(data: data, encoding: .utf8) else {
            return nil
        }
        return token
    }
    
    /// Save complete session data
    func saveSession(_ session: SessionData) throws {
        let encoder = JSONEncoder()
        guard let data = try? encoder.encode(session) else {
            throw KeychainError.encodingFailed
        }
        try save(data, forKey: KeychainKeys.sessionData)
    }
    
    /// Retrieve session data
    func getSession() -> SessionData? {
        guard let data = try? retrieve(forKey: KeychainKeys.sessionData) else {
            return nil
        }
        let decoder = JSONDecoder()
        return try? decoder.decode(SessionData.self, from: data)
    }
    
    /// Clear all session tokens
    func clearSessionTokens() {
        delete(forKey: KeychainKeys.accessToken)
        delete(forKey: KeychainKeys.refreshToken)
        delete(forKey: KeychainKeys.idToken)
        delete(forKey: KeychainKeys.sessionData)
    }
    
    /// Clear all session-related data (tokens + session data)
    func clearAllSessionData() {
        clearSessionTokens()
        
        // Clear any other session-related items
        delete(forKey: "user_info")
        delete(forKey: "persona_data")
        delete(forKey: "auth_state")
    }
    
    // MARK: - Device Identifier
    
    /// Save or retrieve device identifier
    func getDeviceIdentifier() -> String {
        if let existing = try? retrieve(forKey: KeychainKeys.deviceIdentifier),
           let id = String(data: existing, encoding: .utf8) {
            return id
        }
        
        let newId = UUID().uuidString
        if let data = newId.data(using: .utf8) {
            try? save(data, forKey: KeychainKeys.deviceIdentifier)
        }
        return newId
    }
}

// MARK: - Keychain Errors

enum KeychainError: LocalizedError {
    case saveFailed(OSStatus)
    case retrieveFailed(OSStatus)
    case encodingFailed
    case decodingFailed
    
    var errorDescription: String? {
        switch self {
        case .saveFailed(let status):
            return "Failed to save to Keychain: \(status)"
        case .retrieveFailed(let status):
            if status == errSecItemNotFound {
                return "Item not found in Keychain"
            }
            return "Failed to retrieve from Keychain: \(status)"
        case .encodingFailed:
            return "Failed to encode data for Keychain"
        case .decodingFailed:
            return "Failed to decode data from Keychain"
        }
    }
}
