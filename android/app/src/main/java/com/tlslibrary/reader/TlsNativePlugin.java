package com.tlslibrary.reader;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** JS bridge used by lib/library/mobile.ts. */
@CapacitorPlugin(name = "TlsNative")
public class TlsNativePlugin extends Plugin {
    private final ExecutorService executor = Executors.newCachedThreadPool();

    private TlsNativeCore core() {
        return TlsNativeCore.get(getContext());
    }

    @PluginMethod
    public void getConfig(PluginCall call) {
        if (!core().isConfigured()) {
            call.reject("TlsNative is missing apiBaseUrl/authUrl/catalogUrl configuration.");
            return;
        }
        String[] values = core().configStrings();
        JSObject result = new JSObject();
        result.put("apiBaseUrl", values[0]);
        result.put("authUrl", values[1]);
        result.put("catalogUrl", values[2]);
        call.resolve(result);
    }

    @PluginMethod
    public void hasSession(PluginCall call) {
        executor.execute(() -> {
            JSObject result = new JSObject();
            result.put("value", core().tokens.token() != null);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void setToken(PluginCall call) {
        String token = call.getString("token");
        if (token == null || token.isEmpty()) {
            call.reject("token is required");
            return;
        }
        executor.execute(() -> {
            try {
                core().tokens.set(token);
                call.resolve();
            } catch (IllegalStateException error) {
                call.reject(error.getMessage());
            }
        });
    }

    @PluginMethod
    public void clearToken(PluginCall call) {
        core().tokens.clear();
        call.resolve();
    }

    @PluginMethod
    public void request(PluginCall call) {
        executor.execute(() -> {
            try {
                URL url = new URL(call.getString("url", ""));
                Map<String, String> headers = new HashMap<>();
                JSObject rawHeaders = call.getObject("headers", new JSObject());
                for (Iterator<String> keys = rawHeaders.keys(); keys.hasNext(); ) {
                    String name = keys.next();
                    String value = rawHeaders.optString(name, null);
                    if (value != null) headers.put(name, value);
                }
                String body = call.getString("body");
                String bearer;
                switch (call.getString("auth", "none")) {
                    case "session":
                        bearer = core().tokens.token();
                        break;
                    case "bearer":
                        bearer = call.getString("bearer");
                        break;
                    default:
                        bearer = null;
                }

                TlsNativeCore.Response response = core().perform(
                    url,
                    call.getString("method", "GET").toUpperCase(Locale.ROOT),
                    headers,
                    body == null ? null : body.getBytes(StandardCharsets.UTF_8),
                    bearer,
                    Boolean.TRUE.equals(call.getBoolean("followRedirects", false))
                );

                JSObject responseHeaders = new JSObject();
                for (Map.Entry<String, List<String>> entry : response.headers.entrySet()) {
                    if (entry.getKey() != null && !entry.getValue().isEmpty()) {
                        responseHeaders.put(entry.getKey().toLowerCase(Locale.ROOT), String.join(", ", entry.getValue()));
                    }
                }
                JSObject result = new JSObject();
                result.put("status", response.status);
                result.put("headers", responseHeaders);
                result.put("body", TlsNativeCore.utf8(response.body));
                call.resolve(result);
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "Request failed" : error.getMessage(), error);
            }
        });
    }
}
