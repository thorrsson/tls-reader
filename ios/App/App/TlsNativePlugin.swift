import Capacitor
import Foundation

/// JS bridge used by lib/library/mobile.ts.
@objc(TlsNativePlugin)
public class TlsNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "TlsNativePlugin"
    public let jsName = "TlsNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getConfig", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hasSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
    ]

    private var core: TlsNativeCore { .shared }

    @objc func getConfig(_ call: CAPPluginCall) {
        guard let config = core.config else {
            call.reject(TlsNativeCore.Failure.notConfigured.localizedDescription)
            return
        }
        call.resolve(config.json)
    }

    @objc func hasSession(_ call: CAPPluginCall) {
        call.resolve(["value": core.tokens.token != nil])
    }

    @objc func setToken(_ call: CAPPluginCall) {
        guard let token = call.getString("token"), !token.isEmpty else {
            call.reject("token is required")
            return
        }
        do {
            try core.tokens.set(token)
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func clearToken(_ call: CAPPluginCall) {
        core.tokens.clear()
        call.resolve()
    }

    @objc func request(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString),
              url.scheme == "https" || url.scheme == "http" else {
            call.reject("A valid http(s) url is required")
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = call.getString("method", "GET").uppercased()
        for (name, value) in call.getObject("headers", [:]) {
            if let value = value as? String, name.lowercased() != "authorization" {
                request.setValue(value, forHTTPHeaderField: name)
            }
        }
        if let body = call.getString("body") {
            request.httpBody = Data(body.utf8)
        }

        let bearer: String?
        switch call.getString("auth", "none") {
        case "session": bearer = core.tokens.token
        case "bearer": bearer = call.getString("bearer")
        default: bearer = nil
        }

        core.perform(request, bearer: bearer, followRedirects: call.getBool("followRedirects", false)) { result in
            switch result {
            case .failure(let error):
                call.reject(error.localizedDescription)
            case .success(let (response, data)):
                var headers: [String: String] = [:]
                for (name, value) in response.allHeaderFields {
                    if let name = name as? String, let value = value as? String {
                        headers[name.lowercased()] = value
                    }
                }
                call.resolve([
                    "status": response.statusCode,
                    "headers": headers,
                    "body": String(decoding: data, as: UTF8.self),
                ])
            }
        }
    }
}
