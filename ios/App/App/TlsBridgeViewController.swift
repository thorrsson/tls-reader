import Capacitor
import WebKit

/// Capacitor host that registers the in-app TlsNative plugin and swaps in the
/// publication-proxying scheme handler before the web app loads.
final class TlsBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()

        if let bridge {
            let pluginConfig = bridge.config.getPluginConfig("TlsNative")
            TlsNativeCore.shared.configure(apiBaseUrl: pluginConfig.getString("apiBaseUrl"),
                                           authUrl: pluginConfig.getString("authUrl"),
                                           catalogUrl: pluginConfig.getString("catalogUrl"))
            bridge.registerPluginInstance(TlsNativePlugin())
        }

        let scheme = bridge?.config.localURL.scheme ?? "capacitor"
        if let handler = webView?.configuration.urlSchemeHandler(forURLScheme: scheme),
           type(of: handler) == WebViewAssetHandler.self {
            object_setClass(handler, TlsAssetHandler.self)
        }
    }
}
