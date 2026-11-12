package com.tlslibrary.reader;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.annotation.Nullable;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Session token encrypted with a non-exportable Keystore key, 24h lifetime like the web cookie. */
final class TlsTokenStore {
    private static final long MAX_AGE_MS = 24L * 60 * 60 * 1000;
    private static final String KEY_ALIAS = "tls-library-session";
    private static final String PREFS = "tls-library-session";

    private final SharedPreferences prefs;

    TlsTokenStore(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @Nullable
    synchronized String token() {
        String payload = prefs.getString("token", null);
        String iv = prefs.getString("iv", null);
        long expiresAt = prefs.getLong("expiresAt", 0);
        if (payload == null || iv == null) return null;
        if (expiresAt <= System.currentTimeMillis()) {
            clear();
            return null;
        }
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            return new String(cipher.doFinal(Base64.decode(payload, Base64.NO_WRAP)), StandardCharsets.UTF_8);
        } catch (Exception error) {
            clear();
            return null;
        }
    }

    synchronized void set(String token) {
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] encrypted = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
            prefs
                .edit()
                .putString("token", Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .putString("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
                .putLong("expiresAt", System.currentTimeMillis() + MAX_AGE_MS)
                .apply();
        } catch (Exception error) {
            clear();
            throw new IllegalStateException("Unable to store the session token.", error);
        }
    }

    synchronized void clear() {
        prefs.edit().clear().apply();
    }

    private static SecretKey key() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(
            new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build()
        );
        return generator.generateKey();
    }
}
