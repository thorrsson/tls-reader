package com.tlslibrary.reader;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginConfig;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(TlsNativePlugin.class);
        super.onCreate(savedInstanceState);

        PluginConfig config = getBridge().getConfig().getPluginConfiguration("TlsNative");
        TlsNativeCore.get(this).configure(config.getString("apiBaseUrl"), config.getString("authUrl"), config.getString("catalogUrl"));
        getBridge().setWebViewClient(new TlsWebViewClient(getBridge()));
    }
}
