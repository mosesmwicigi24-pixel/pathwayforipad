// Minimal Keychain wrapper for the session tokens (§5.7 — secure token vault on
// device, the native equivalent of the web portal's localStorage pair).
import Foundation
import Security

enum Keychain {
    private static let service = "org.nuruplace.portal.session"
    // Mac Catalyst: SecItem* fails with errSecMissingEntitlement unless the app
    // is signed with a keychain-access-groups profile (Config/NuruPortal.
    // entitlements is staged for that; wiring it requires a signed-in Xcode
    // account). Until then, persist via UserDefaults on the Mac — the same
    // trust level as the web portal's localStorage tokens on this machine.
    // iOS always uses the real Keychain (§5.7).
    private static let defaultsPrefix = "kc.fallback."

    static func set(_ value: String?, for key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
        guard let value, let data = value.data(using: .utf8) else {
            UserDefaults.standard.removeObject(forKey: defaultsPrefix + key)
            return
        }
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        let status = SecItemAdd(add as CFDictionary, nil)
        #if targetEnvironment(macCatalyst)
        if status != errSecSuccess {
            UserDefaults.standard.set(value, forKey: defaultsPrefix + key)
        } else {
            UserDefaults.standard.removeObject(forKey: defaultsPrefix + key)
        }
        #else
        _ = status
        #endif
    }

    static func get(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
           let data = item as? Data,
           let str = String(data: data, encoding: .utf8) {
            return str
        }
        #if targetEnvironment(macCatalyst)
        return UserDefaults.standard.string(forKey: defaultsPrefix + key)
        #else
        return nil
        #endif
    }
}
