import type { CapacitorConfig } from "@capacitor/cli";
import { loadEnvConfig } from "@next/env";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildConfig } = require("./scripts/build-config.cjs") as {
  buildConfig: () => Record<string, string>;
};

loadEnvConfig(process.cwd(), false);
const backend = buildConfig();

const config: CapacitorConfig = {
  appId: "com.tlslibrary.reader",
  appName: "TLS Reader",
  webDir: "out",
  plugins: {
    // Read by the native TlsNative plugin. The session token is only ever sent
    // to these origins.
    TlsNative: {
      apiBaseUrl: backend.NEXT_PUBLIC_TLS_API_BASE_URL,
      authUrl: backend.NEXT_PUBLIC_TLS_AUTH_URL,
      catalogUrl: backend.NEXT_PUBLIC_TLS_CATALOG_URL,
    },
  },
};

export default config;
