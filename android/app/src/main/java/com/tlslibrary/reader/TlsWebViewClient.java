package com.tlslibrary.reader;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.annotation.Nullable;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import java.io.ByteArrayInputStream;
import java.net.URL;
import java.net.URLDecoder;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;

/**
 * Serves {@code /api/library/pub/<id>/<path>} (chapters, images, stylesheets) by
 * proxying the authenticated backend, so iframe and {@code <img>} loads work
 * without a Next server. Everything else goes to Capacitor's local server.
 */
final class TlsWebViewClient extends BridgeWebViewClient {
    private static final String PREFIX = "/api/library/pub/";

    private final Bridge bridge;

    TlsWebViewClient(Bridge bridge) {
        super(bridge);
        this.bridge = bridge;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri uri = request.getUrl();
        String path = uri.getEncodedPath();
        Uri local = Uri.parse(bridge.getLocalUrl());
        if (path == null || !path.startsWith(PREFIX) || !sameOrigin(uri, local)) {
            return super.shouldInterceptRequest(view, request);
        }
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return super.shouldInterceptRequest(view, request);
        }

        TlsNativeCore core = TlsNativeCore.get(view.getContext());
        URL target = upstreamUrl(path.substring(PREFIX.length()), uri.getEncodedQuery(), core.apiBaseUrl());
        if (target == null) {
            return error(404, "Unknown publication resource.");
        }
        String token = core.tokens.token();
        if (token == null) {
            return error(401, "No active session.");
        }

        Map<String, String> headers = new HashMap<>();
        headers.put("Accept", header(request, "Accept", "*/*"));
        String range = header(request, "Range", null);
        if (range != null) headers.put("Range", range);

        try {
            TlsNativeCore.Response response = core.perform(target, "GET", headers, null, token, false);
            if (response.status < 200 || response.status >= 300) {
                if (response.status == 401 || response.status == 403) {
                    core.tokens.clear();
                }
                String message = TlsNativeCore.utf8(response.body);
                int status = response.status >= 300 && response.status < 400 ? 502 : response.status;
                return error(status, message.isEmpty() ? "Publication request failed (" + response.status + ")." : message);
            }

            String contentType = response.header("Content-Type");
            if (contentType == null) contentType = "application/octet-stream";
            Map<String, String> outHeaders = new HashMap<>();
            outHeaders.put("Cache-Control", orDefault(response.header("Cache-Control"), "no-cache"));
            for (String name : new String[] { "Content-Range", "Accept-Ranges" }) {
                String value = response.header(name);
                if (value != null) outHeaders.put(name, value);
            }
            String[] typeParts = contentType.split(";\\s*charset=", 2);
            return new WebResourceResponse(
                typeParts[0].trim(),
                typeParts.length > 1 ? typeParts[1].trim() : null,
                response.status,
                response.status == 206 ? "Partial Content" : "OK",
                outHeaders,
                new ByteArrayInputStream(response.body)
            );
        } catch (Exception error) {
            return error(502, "Library service is unreachable.");
        }
    }

    private static boolean sameOrigin(Uri a, Uri b) {
        return a.getScheme() != null && a.getScheme().equalsIgnoreCase(b.getScheme())
            && a.getAuthority() != null && a.getAuthority().equalsIgnoreCase(b.getAuthority());
    }

    /** Mirrors lib/library/publication.ts: decode the path, then re-encode each segment. */
    @Nullable
    static URL upstreamUrl(String remainder, @Nullable String query, @Nullable URL apiBaseUrl) {
        int slash = remainder.indexOf('/');
        if (apiBaseUrl == null || slash <= 0) return null;
        try {
            String publicationId = decode(remainder.substring(0, slash));
            StringBuilder path = new StringBuilder("/pub/").append(encode(publicationId));
            int segments = 0;
            for (String segment : decode(remainder.substring(slash + 1)).split("/")) {
                if (segment.isEmpty()) continue;
                path.append('/').append(encode(segment));
                segments++;
            }
            if (segments == 0) return null;
            if (query != null && !query.isEmpty()) path.append('?').append(query);
            return new URL(apiBaseUrl, path.toString());
        } catch (Exception error) {
            return null;
        }
    }

    private static String decode(String value) {
        try {
            return URLDecoder.decode(value.replace("+", "%2B"), "UTF-8");
        } catch (Exception error) {
            return value;
        }
    }

    /** Equivalent of JavaScript's encodeURIComponent. */
    private static String encode(String value) throws Exception {
        return URLEncoder.encode(value, "UTF-8")
            .replace("+", "%20")
            .replace("%21", "!")
            .replace("%27", "'")
            .replace("%28", "(")
            .replace("%29", ")")
            .replace("%7E", "~");
    }

    private static String header(WebResourceRequest request, String name, @Nullable String fallback) {
        for (Map.Entry<String, String> entry : request.getRequestHeaders().entrySet()) {
            if (entry.getKey().equalsIgnoreCase(name)) return entry.getValue();
        }
        return fallback;
    }

    private static String orDefault(@Nullable String value, String fallback) {
        return value == null ? fallback : value;
    }

    private static WebResourceResponse error(int status, String message) {
        byte[] body;
        try {
            body = new JSONObject().put("error", message).toString().getBytes(StandardCharsets.UTF_8);
        } catch (Exception jsonError) {
            body = new byte[0];
        }
        return new WebResourceResponse("application/json", "utf-8", status, reason(status), new HashMap<>(), new ByteArrayInputStream(body));
    }

    private static String reason(int status) {
        switch (status) {
            case 401: return "Unauthorized";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 502: return "Bad Gateway";
            default: return "Error";
        }
    }
}
