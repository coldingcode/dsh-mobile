import Foundation
import UIKit

/// One paired computer. The token is the only secret in this value; it is
/// persisted exclusively in the iOS Keychain by KeychainStore.
struct ServerProfile: Codable, Identifiable, Equatable {
    var id: UUID
    var displayName: String
    var baseURL: URL
    var token: String
    var fingerprint: String?
    var pairedAt: Date
    var tokenExpiresAt: Date?
    var permissionMode: String?
    var platform: String?
    var model: String?
    var appVersion: String?

    var host: String {
        if let host = baseURL.host, !host.isEmpty { return host }
        return baseURL.absoluteString
    }

    var isDangerFullAccess: Bool {
        permissionMode == "danger-full-access"
    }

    var permissionLabel: String {
        isDangerFullAccess ? "完整访问" : "工作区写入"
    }

    var modelLabel: String {
        (model ?? "deepseek-flash").replacingOccurrences(of: "deepseek-", with: "")
    }
}

struct PairingPayload: Identifiable, Equatable, Codable {
    var v: Int = 1
    var u: String
    var c: String
    var n: String
    var exp: Double
    var f: String?

    var id: String { u + "|" + c }

    var baseURL: URL? {
        URL(string: u)
    }

    var code: String {
        PairingPayload.formatCode(c)
    }

    var isExpired: Bool {
        Date().timeIntervalSince1970 * 1000 > exp
    }

    init(v: Int = 1, u: String, c: String, n: String, exp: Double, f: String? = nil) {
        self.v = v
        self.u = u.hasSuffix("/") ? String(u.dropLast()) : u
        self.c = PairingPayload.normalizeCode(c)
        self.n = n
        self.exp = exp
        self.f = f
    }

    init?(scannerText raw: String) {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        let encoded: String?
        if let url = URL(string: text), url.scheme == "dshm" {
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            encoded = components?.queryItems?.first(where: { $0.name == "d" })?.value
        } else if text.hasPrefix("dshm://") {
            let components = URLComponents(string: text)
            encoded = components?.queryItems?.first(where: { $0.name == "d" })?.value
        } else {
            encoded = text
        }
        guard let encoded, let data = PairingPayload.decodeBase64URL(encoded) else { return nil }
        guard let payload = try? JSONDecoder().decode(PairingPayload.self, from: data) else { return nil }
        guard payload.v == 1,
              let url = URL(string: payload.u),
              url.scheme == "http" || url.scheme == "https",
              !payload.c.isEmpty else { return nil }
        self = PairingPayload(v: 1, u: payload.u, c: payload.c, n: payload.n, exp: payload.exp, f: payload.f)
    }

    static func makeManual(baseURL: URL, code: String, serverName: String) -> PairingPayload {
        PairingPayload(
            v: 1,
            u: baseURL.absoluteString,
            c: normalizeCode(code),
            n: serverName,
            exp: Date().addingTimeInterval(600).timeIntervalSince1970 * 1000,
            f: nil
        )
    }

    static func normalizeCode(_ raw: String) -> String {
        let cleaned = raw.uppercased().filter { $0.isLetter || $0.isNumber }
            .replacingOccurrences(of: "I", with: "1")
            .replacingOccurrences(of: "L", with: "1")
            .replacingOccurrences(of: "O", with: "0")
            .replacingOccurrences(of: "U", with: "V")
        return String(cleaned.prefix(8))
    }

    static func formatCode(_ raw: String) -> String {
        let clean = normalizeCode(raw)
        guard clean.count == 8 else { return clean }
        let first = String(clean.prefix(4))
        let last = String(clean.suffix(4))
        return first + "-" + last
    }

    private static func decodeBase64URL(_ text: String) -> Data? {
        var value = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        let remainder = value.count % 4
        if remainder > 0 { value += String(repeating: "=", count: 4 - remainder) }
        return Data(base64Encoded: value, options: [.ignoreUnknownCharacters])
    }
}

enum DeviceIdentity {
    private static let key = "dshm-device-id"

    static var id: String {
        if let value = UserDefaults.standard.string(forKey: key), !value.isEmpty { return value }
        let created = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
        UserDefaults.standard.set(created, forKey: key)
        return created
    }

    static var name: String {
        let name = UIDevice.current.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if name.isEmpty { return UIDevice.current.model }
        return String(name.prefix(60))
    }

    static var appVersion: String {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return version + " (" + build + ")"
    }
}
