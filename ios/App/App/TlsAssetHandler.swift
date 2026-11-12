import Capacitor
import WebKit

/// Serves `/api/library/pub/<id>/<path>` (chapters, images, stylesheets) by
/// proxying the authenticated backend, so iframe and `<img>` loads work without
/// a Next server. Everything else falls through to Capacitor's bundled assets.
///
/// Installed with `object_setClass` on Capacitor's own handler, so it must not
/// declare stored properties.
final class TlsAssetHandler: WebViewAssetHandler {
    private static let prefix = "/api/library/pub/"
    private static let tasks = TlsSchemeTaskRegistry()

    override func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.percentEncodedPath.hasPrefix(Self.prefix) else {
            super.webView(webView, start: urlSchemeTask)
            return
        }

        let core = TlsNativeCore.shared
        guard let target = Self.upstreamUrl(for: components, apiBaseUrl: core.config?.apiBaseUrl) else {
            Self.respond(urlSchemeTask, url: url, status: 404, error: "Unknown publication resource.")
            return
        }
        guard let token = core.tokens.token else {
            Self.respond(urlSchemeTask, url: url, status: 401, error: "No active session.")
            return
        }

        var request = URLRequest(url: target)
        request.setValue(urlSchemeTask.request.value(forHTTPHeaderField: "Accept") ?? "*/*", forHTTPHeaderField: "Accept")
        if let range = urlSchemeTask.request.value(forHTTPHeaderField: "Range") {
            request.setValue(range, forHTTPHeaderField: "Range")
        }

        let key = ObjectIdentifier(urlSchemeTask)
        Self.tasks.begin(key)
        let task = core.perform(request, bearer: token, followRedirects: false) { result in
            DispatchQueue.main.async {
                guard Self.tasks.finish(key) else { return }
                switch result {
                case .failure:
                    Self.respond(urlSchemeTask, url: url, status: 502, error: "Library service is unreachable.")
                case .success(let (response, data)):
                    guard (200..<300).contains(response.statusCode) else {
                        if response.statusCode == 401 || response.statusCode == 403 {
                            core.tokens.clear()
                        }
                        let message = String(decoding: data, as: UTF8.self)
                        Self.respond(urlSchemeTask, url: url, status: response.statusCode,
                                     error: message.isEmpty ? "Publication request failed (\(response.statusCode))." : message)
                        return
                    }
                    var headers = ["Content-Type": response.value(forHTTPHeaderField: "Content-Type") ?? "application/octet-stream",
                                   "Cache-Control": response.value(forHTTPHeaderField: "Cache-Control") ?? "no-cache",
                                   "Content-Length": String(data.count)]
                    for name in ["Content-Range", "Accept-Ranges"] {
                        if let value = response.value(forHTTPHeaderField: name) { headers[name] = value }
                    }
                    Self.send(urlSchemeTask, url: url, status: response.statusCode, headers: headers, body: data)
                }
            }
        }
        Self.tasks.attach(key, task)
    }

    override func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        if !Self.tasks.cancel(ObjectIdentifier(urlSchemeTask)) {
            super.webView(webView, stop: urlSchemeTask)
        }
    }

    /// Mirrors lib/library/publication.ts: decode the path, then re-encode each
    /// segment like `encodeURIComponent`.
    static func upstreamUrl(for components: URLComponents, apiBaseUrl: URL?) -> URL? {
        guard let apiBaseUrl else { return nil }
        let remainder = components.percentEncodedPath.dropFirst(prefix.count)
        guard let slash = remainder.firstIndex(of: "/") else { return nil }
        let rawId = String(remainder[..<slash])
        let rawPath = String(remainder[remainder.index(after: slash)...])
        let publicationId = rawId.removingPercentEncoding ?? rawId
        let resourcePath = (rawPath.removingPercentEncoding ?? rawPath)
            .split(separator: "/")
            .map { encodeComponent(String($0)) }
            .joined(separator: "/")
        guard !publicationId.isEmpty, !resourcePath.isEmpty,
              var target = URLComponents(url: apiBaseUrl, resolvingAgainstBaseURL: false) else { return nil }
        target.percentEncodedPath = "/pub/\(encodeComponent(publicationId))/\(resourcePath)"
        target.percentEncodedQuery = components.percentEncodedQuery
        return target.url
    }

    private static let uriComponentAllowed: CharacterSet = {
        var set = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
        set.insert(charactersIn: "-_.!~*'()")
        return set
    }()

    private static func encodeComponent(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: uriComponentAllowed) ?? value
    }

    private static func respond(_ task: WKURLSchemeTask, url: URL, status: Int, error: String) {
        let body = (try? JSONSerialization.data(withJSONObject: ["error": error])) ?? Data()
        send(task, url: url, status: status,
             headers: ["Content-Type": "application/json", "Content-Length": String(body.count)], body: body)
    }

    private static func send(_ task: WKURLSchemeTask, url: URL, status: Int, headers: [String: String], body: Data) {
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers) else {
            task.didFailWithError(URLError(.badServerResponse))
            return
        }
        task.didReceive(response)
        task.didReceive(body)
        task.didFinish()
    }
}

/// Tracks in-flight proxied scheme tasks. WebKit raises if a task is used after
/// `stop`, so completions only respond to tasks that are still registered.
final class TlsSchemeTaskRegistry {
    private let lock = NSLock()
    private var tasks: [ObjectIdentifier: URLSessionDataTask?] = [:]

    func begin(_ key: ObjectIdentifier) {
        lock.lock(); defer { lock.unlock() }
        tasks[key] = .some(nil)
    }

    func attach(_ key: ObjectIdentifier, _ task: URLSessionDataTask?) {
        lock.lock(); defer { lock.unlock() }
        if tasks[key] != nil { tasks[key] = task }
    }

    /// Returns false if the task was stopped (or already finished).
    func finish(_ key: ObjectIdentifier) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return tasks.removeValue(forKey: key) != nil
    }

    /// Returns false if the task is not one of ours.
    func cancel(_ key: ObjectIdentifier) -> Bool {
        lock.lock()
        guard let entry = tasks.removeValue(forKey: key) else {
            lock.unlock()
            return false
        }
        lock.unlock()
        entry?.cancel()
        return true
    }
}
