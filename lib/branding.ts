import Ajv2020 from "ajv/dist/2020";
import brandingConfigJson from "@/config/thorium-web/branding.local.json";
import brandingSchema from "@/config/thorium-web/branding.schema.json";
import preferencesMapJson from "@/config/thorium-web/preferences-map.json";

export type ActionKey =
  | "openLibrary"
  | "openCatalog"
  | "download"
  | "readNow"
  | "returnLoan"
  | "renewLoan"
  | "account"
  | "signOut";

export type BrandingConfig = {
  brand: {
    id: string;
    name: string;
  };
  theme: {
    colors: {
      background: string;
      surface: string;
      surfaceAlt: string;
      textPrimary: string;
      textSecondary: string;
      border: string;
      focus: string;
      accent: string;
      accentText: string;
      danger: string;
      warning: string;
      success: string;
    };
  };
  typography: {
    fontFamilyBase: string;
    fontFamilyHeading: string;
    fontSizeBase: number;
    fontScale: number;
    lineHeightBase: number;
    fontWeightRegular: number;
    fontWeightMedium: number;
    fontWeightBold: number;
  };
  spacing: {
    unit: number;
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
    radiusSm: number;
    radiusMd: number;
    radiusLg: number;
  };
  assets: {
    logo: {
      src: string;
      alt: string;
      width?: number;
      height?: number;
    };
  };
  actions: {
    order: ActionKey[];
    visibility: Record<ActionKey, boolean>;
  };
  authHandoff: {
    loginEndpoint: string;
    entitlementsEndpoint: string;
    acquireEndpointTemplate: string;
    tokenTransport: "bearerHeader" | "queryParam";
    tokenTtlSkewSeconds: number;
  };
  library: {
    source: "entitlements" | "opds" | "hybrid";
    requireEntitlement: boolean;
    maxItems: number;
  };
};

type PreferencesMap = Record<string, string>;

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateBrandingConfig = ajv.compile<BrandingConfig>(
  brandingSchema as Record<string, unknown>,
);

const loadedBrandingConfig = brandingConfigJson as BrandingConfig;

if (!validateBrandingConfig(loadedBrandingConfig)) {
  throw new Error(
    `Invalid branding.local.json: ${ajv.errorsText(validateBrandingConfig.errors, {
      separator: "; ",
    })}`,
  );
}

export const brandingConfig = loadedBrandingConfig;

const preferencesMap = preferencesMapJson as PreferencesMap;

const getNestedValue = (value: unknown, dottedPath: string): unknown => {
  const path = dottedPath.split(".");
  let current: unknown = value;
  for (const segment of path) {
    if (typeof current !== "object" || current === null) {
      return undefined;
    }
    const record = current as Record<string, unknown>;
    current = record[segment];
  }
  return current;
};

const setNestedValue = (
  value: Record<string, unknown>,
  dottedPath: string,
  fieldValue: unknown,
): void => {
  const path = dottedPath.split(".");
  let current = value;
  path.slice(0, -1).forEach((segment) => {
    const existing = current[segment];
    if (typeof existing !== "object" || existing === null) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  });
  const finalSegment = path[path.length - 1];
  current[finalSegment] = fieldValue;
};

const mapToReaderPreferences = (
  branding: BrandingConfig,
  map: PreferencesMap,
): Record<string, unknown> => {
  const mapped: Record<string, unknown> = {};
  const source = { tokens: branding };
  Object.entries(map).forEach(([fromPath, toPath]) => {
    const tokenValue = getNestedValue(source, fromPath);
    if (typeof tokenValue !== "undefined") {
      setNestedValue(mapped, toPath, tokenValue);
    }
  });
  return mapped;
};

export const readerPreferences = mapToReaderPreferences(
  brandingConfig,
  preferencesMap,
);

const resolveUrl = (base: string, endpoint: string): string => {
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    return endpoint;
  }
  return new URL(endpoint, base).toString();
};

const tlsApiBaseUrl =
  process.env.NEXT_PUBLIC_TLS_API_BASE_URL ?? "http://localhost:8080";

export const integrationConfig = {
  tlsApiBaseUrl,
  authUrl:
    process.env.NEXT_PUBLIC_TLS_AUTH_URL ??
    resolveUrl(tlsApiBaseUrl, brandingConfig.authHandoff.loginEndpoint),
  catalogUrl:
    process.env.NEXT_PUBLIC_TLS_CATALOG_URL ?? resolveUrl(tlsApiBaseUrl, "/opds"),
  baseReaderUrl:
    process.env.NEXT_PUBLIC_TLS_BASE_READER_URL ?? "http://localhost:3000",
};
