import Foundation
import Security

/// Shared native state for the TLS library: backend configuration, the session
/// token (kept in the Keychain, never in WebView storage) and upstream HTTP.
final class TlsNativeCore: NSObject, URLSessionTaskDelegate {
    static let shared = TlsNativeCore()

    struct Config {
        let apiBaseUrl: URL
        let authUrl: URL
        let catalogUrl: URL

        var json: [String: String] {
            ["apiBaseUrl": apiBaseUrl.absoluteString, "authUrl": authUrl.absoluteString, "catalogUrl": catalogUrl.absoluteString]
        }
    }

    enum Failure: LocalizedError {
        case notConfigured
        case invalidUrl(String)
        case untrustedOrigin(String)

        var errorDescription: String? {
            switch self {
            case .notConfigured: return "TlsNative is missing apiBaseUrl/authUrl/catalogUrl configuration."
            case .invalidUrl(let url): return "Invalid URL: \(url)"
            case .untrustedOrigin(let url): return "Refusing to send credentials to \(url)"
            }
        }
    }

    private(set) var config: Config?
    let tokens = TlsTokenStore()

    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        configuration.timeoutIntervalForRequest = 60
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()

    private let lock = NSLock()
    private var noRedirectTasks = Set<Int>()

    func configure(apiBaseUrl: String?, authUrl: String?, catalogUrl: String?) {
        guard let api = apiBaseUrl.flatMap(URL.init(string:)),
              let auth = authUrl.flatMap(URL.init(string:)),
              let catalog = catalogUrl.flatMap(URL.init(string:)) else {
            config = nil
            return
        }
        config = Config(apiBaseUrl: api, authUrl: auth, catalogUrl: catalog)
    }

    /// Credentials are only ever attached to the configured backend origins.
    func isTrusted(_ url: URL) -> Bool {
        guard let config else { return false }
        return [config.apiBaseUrl, config.authUrl, config.catalogUrl].contains { Self.origin($0) == Self.origin(url) }
    }

    private static func origin(_ url: URL) -> String {
        let scheme = url.scheme?.lowercased() ?? ""
        let host = url.host?.lowercased() ?? ""
        let port = url.port ?? (scheme == "https" ? 443 : scheme == "http" ? 80 : -1)
        return "\(scheme)://\(host):\(port)"
    }

    /// Starts an upstream request. When `bearer` is set the target must be a
    /// trusted origin and redirects are never followed.
    @discardableResult
    func perform(_ request: URLRequest,
                 bearer: String?,
                 followRedirects: Bool,
                 completion: @escaping (Result<(HTTPURLResponse, Data), Error>) -> Void) -> URLSessionDataTask? {
        var request = request
        guard let url = request.url else {
            completion(.failure(Failure.invalidUrl("")))
            return nil
        }
        if let bearer {
            guard isTrusted(url) else {
                completion(.failure(Failure.untrustedOrigin(url.absoluteString)))
                return nil
            }
            request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        }
        var taskId = -1
        let task = session.dataTask(with: request) { [weak self] data, response, error in
            if let self {
                self.lock.lock()
                self.noRedirectTasks.remove(taskId)
                self.lock.unlock()
            }
            if let error {
                completion(.failure(error))
            } else if let http = response as? HTTPURLResponse {
                completion(.success((http, data ?? Data())))
            } else {
                completion(.failure(URLError(.badServerResponse)))
            }
        }
        taskId = task.taskIdentifier
        if bearer != nil || !followRedirects {
            lock.lock()
            noRedirectTasks.insert(task.taskIdentifier)
            lock.unlock()
        }
        task.resume()
        return task
    }

    func urlSession(_ session: URLSession,
                    task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        lock.lock()
        let blocked = noRedirectTasks.contains(task.taskIdentifier)
        lock.unlock()
        completionHandler(blocked ? nil : request)
    }

}

/// Session token in the Keychain with the same 24h lifetime as the web cookie.
final class TlsTokenStore {
    static let maxAge: TimeInterval = 60 * 60 * 24

    private let service = "com.tlslibrary.reader.session"
    private let account = "library-token"
    private let lock = NSLock()

    private struct Stored: Codable {
        let token: String
        let expiresAt: Date
    }

    var token: String? {
        lock.lock()
        defer { lock.unlock() }
        guard let stored = read() else { return nil }
        if stored.expiresAt <= Date() {
            delete()
            return nil
        }
        return stored.token
    }

    struct KeychainError: LocalizedError {
        let status: OSStatus
        var errorDescription: String? { "Unable to store the session token (Keychain status \(status))." }
    }

    func set(_ token: String) throws {
        lock.lock()
        defer { lock.unlock() }
        delete()
        let data = try JSONEncoder().encode(Stored(token: token, expiresAt: Date().addingTimeInterval(Self.maxAge)))
        var query = baseQuery
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw KeychainError(status: status) }
    }

    func clear() {
        lock.lock()
        defer { lock.unlock() }
        delete()
    }

    private var baseQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    private func read() -> Stored? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(Stored.self, from: data)
    }

    private func delete() {
        SecItemDelete(baseQuery as CFDictionary)
    }
}
