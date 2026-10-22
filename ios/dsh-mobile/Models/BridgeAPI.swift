import Foundation

enum BridgeAPIError: LocalizedError {
    case invalidURL
    case transport(String)
    case server(status: Int, message: String)
    case malformedResponse

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "地址格式不正确"
        case .transport(let message):
            return "无法连接电脑：" + message
        case .server(_, let message):
            return message
        case .malformedResponse:
            return "电脑返回了无法识别的数据"
        }
    }
}

struct BridgeHealth: Decodable {
    let ok: Bool
    let version: String
    let serverName: String
    let platform: String
    let permissionMode: String
    let model: String
    let workspace: String
    let protocolVersion: Int

    enum CodingKeys: String, CodingKey {
        case ok, version, serverName, platform, permissionMode, model, workspace
        case protocolVersion = "protocol"
    }
}

struct PairInfoResponse: Decodable {
    let serverName: String
    let version: String
    let platform: String
    let validCode: Bool
    let expiresAt: Double?
}

struct PairRequestReceipt: Decodable {
    let requestId: String
    let verificationCode: String
    let expiresAt: Double
    let serverName: String
    let serverUrl: String
}

struct PairDevice: Decodable {
    let id: String
    let name: String
    let platform: String?
}

struct PairStatusResponse: Decodable {
    let status: String
    let token: String?
    let tokenExpiresAt: Double?
    let reason: String?
    let device: PairDevice?
}

private struct PairRequestBody: Encodable {
    let code: String
    let deviceId: String
    let deviceName: String
    let platform: String
    let appVersion: String
}

private struct ApiErrorBody: Decodable {
    let error: String?
    let message: String?
}

struct BridgeAPI {
    let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    init(baseURL: URL) {
        self.baseURL = baseURL
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 30
        configuration.waitsForConnectivity = true
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        self.session = URLSession(configuration: configuration)
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
    }

    func health() async throws -> BridgeHealth {
        try await request(path: "/api/health")
    }

    func pairInfo(code: String) async throws -> PairInfoResponse {
        try await request(path: "/api/pair/info?code=" + (code.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? code))
    }

    func pairRequest(code: String, deviceName: String) async throws -> PairRequestReceipt {
        let body = PairRequestBody(
            code: code,
            deviceId: DeviceIdentity.id,
            deviceName: deviceName,
            platform: "iOS",
            appVersion: DeviceIdentity.appVersion
        )
        let data = try encoder.encode(body)
        return try await request(path: "/api/pair/request", method: "POST", body: data)
    }

    func pairStatus(requestId: String) async throws -> PairStatusResponse {
        try await request(path: "/api/pair/request/" + requestId)
    }

    func logout(token: String) async {
        _ = try? await requestRaw(path: "/api/logout", method: "POST", token: token, body: Data("{}".utf8))
    }

    private func request<T: Decodable>(path: String, method: String = "GET", body: Data? = nil, token: String? = nil) async throws -> T {
        let data = try await requestRaw(path: path, method: method, token: token, body: body)
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw BridgeAPIError.malformedResponse
        }
    }

    private func requestRaw(path: String, method: String, token: String? = nil, body: Data? = nil) async throws -> Data {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw BridgeAPIError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token, !token.isEmpty {
            request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        }
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw BridgeAPIError.malformedResponse
            }
            guard (200..<300).contains(http.statusCode) else {
                let parsed = try? decoder.decode(ApiErrorBody.self, from: data)
                let message = parsed?.message ?? parsed?.error ?? ("HTTP " + String(http.statusCode))
                throw BridgeAPIError.server(status: http.statusCode, message: message)
            }
            return data
        } catch let error as BridgeAPIError {
            throw error
        } catch {
            throw BridgeAPIError.transport(error.localizedDescription)
        }
    }
}

extension Double {
    var millisecondsDate: Date {
        Date(timeIntervalSince1970: self / 1000)
    }
}
