package com.tlslibrary.reader;

import android.content.Context;
import androidx.annotation.Nullable;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Shared native state for the TLS library: backend configuration, the session
 * token (encrypted with an Android Keystore key, never in WebView storage) and
 * upstream HTTP.
 */
final class TlsNativeCore {
    private static TlsNativeCore instance;

    static synchronized TlsNativeCore get(Context context) {
        if (instance == null) {
            instance = new TlsNativeCore(context.getApplicationContext());
        }
        return instance;
    }

    static final class Response {
        final int status;
        final Map<String, List<String>> headers;
        final byte[] body;

        Response(int status, Map<String, List<String>> headers, byte[] body) {
            this.status = status;
            this.headers = headers;
            this.body = body;
        }

        @Nullable
        String header(String name) {
            for (Map.Entry<String, List<String>> entry : headers.entrySet()) {
                if (entry.getKey() != null && entry.getKey().equalsIgnoreCase(name) && !entry.getValue().isEmpty()) {
                    return entry.getValue().get(0);
                }
            }
            return null;
        }
    }

    final TlsTokenStore tokens;
    @Nullable private URL apiBaseUrl;
    @Nullable private URL authUrl;
    @Nullable private URL catalogUrl;

    private TlsNativeCore(Context context) {
        tokens = new TlsTokenStore(context);
    }

    synchronized void configure(@Nullable String api, @Nullable String auth, @Nullable String catalog) {
        try {
            apiBaseUrl = api == null ? null : new URL(api);
            authUrl = auth == null ? null : new URL(auth);
            catalogUrl = catalog == null ? null : new URL(catalog);
        } catch (IOException error) {
            apiBaseUrl = null;
            authUrl = null;
            catalogUrl = null;
        }
    }

    synchronized boolean isConfigured() {
        return apiBaseUrl != null && authUrl != null && catalogUrl != null;
    }

    @Nullable
    synchronized URL apiBaseUrl() {
        return apiBaseUrl;
    }

    synchronized String[] configStrings() {
        return new String[] { String.valueOf(apiBaseUrl), String.valueOf(authUrl), String.valueOf(catalogUrl) };
    }

    /** Credentials are only ever attached to the configured backend origins. */
    synchronized boolean isTrusted(URL url) {
        if (!isConfigured()) return false;
        String origin = origin(url);
        return origin.equals(origin(apiBaseUrl)) || origin.equals(origin(authUrl)) || origin.equals(origin(catalogUrl));
    }

    private static String origin(URL url) {
        int port = url.getPort() == -1 ? url.getDefaultPort() : url.getPort();
        return url.getProtocol().toLowerCase(Locale.ROOT) + "://" + url.getHost().toLowerCase(Locale.ROOT) + ":" + port;
    }

    /**
     * Performs an upstream request on the calling thread. When {@code bearer} is
     * set the target must be trusted and redirects are never followed.
     */
    Response perform(
        URL url,
        String method,
        Map<String, String> headers,
        @Nullable byte[] body,
        @Nullable String bearer,
        boolean followRedirects
    ) throws IOException {
        String protocol = url.getProtocol();
        if (!"https".equals(protocol) && !"http".equals(protocol)) {
            throw new IOException("Unsupported URL scheme: " + protocol);
        }
        if (bearer != null && !isTrusted(url)) {
            throw new IOException("Refusing to send credentials to " + url);
        }

        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        try {
            connection.setInstanceFollowRedirects(followRedirects && bearer == null);
            connection.setUseCaches(false);
            connection.setConnectTimeout(30_000);
            connection.setReadTimeout(60_000);
            connection.setRequestMethod(method);
            for (Map.Entry<String, String> header : headers.entrySet()) {
                if (!"authorization".equalsIgnoreCase(header.getKey())) {
                    connection.setRequestProperty(header.getKey(), header.getValue());
                }
            }
            if (bearer != null) {
                connection.setRequestProperty("Authorization", "Bearer " + bearer);
            }
            if (body != null) {
                connection.setDoOutput(true);
                try (OutputStream out = connection.getOutputStream()) {
                    out.write(body);
                }
            }

            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            return new Response(status, connection.getHeaderFields(), readAll(stream));
        } finally {
            connection.disconnect();
        }
    }

    private static byte[] readAll(@Nullable InputStream stream) throws IOException {
        if (stream == null) return new byte[0];
        try (InputStream in = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
            return out.toByteArray();
        }
    }

    static String utf8(byte[] bytes) {
        return new String(bytes, StandardCharsets.UTF_8);
    }
}
