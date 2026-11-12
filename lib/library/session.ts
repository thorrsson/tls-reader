import brandingConfig from "@/config/thorium-web/branding.local.json";
import {
  jsonResult,
  noSessionResult,
  type LibraryConfig,
  type LibraryContext,
  type LibraryResult,
  type UpstreamAuth,
} from "./types";

export type CatalogItem = {
  title: string;
  identifier: string | null;
  assetId: string | null;
  publicationId: string | null;
  coverUrl: string | null;
  author: string | null;
  manifestUrl: string | null;
};

class LibraryRequestError extends Error {
  status: number;
  clearSession: boolean;

  constructor(message: string, status: number, clearSession = false) {
    super(message);
    this.name = "LibraryRequestError";
    this.status = status;
    this.clearSession = clearSession;
  }
}

const isSessionAuthError = (status: number): boolean => status === 401 || status === 403;

const toLibraryRequestError = (label: string, status: number): LibraryRequestError =>
  new LibraryRequestError(
    `${label} request failed (${status}).`,
    status >= 500 ? 502 : status,
    isSessionAuthError(status),
  );

const toErrorPayload = (
  error: unknown,
): { error: string; status: number; clearSession: boolean } => {
  if (error instanceof LibraryRequestError) {
    return {
      error: error.message,
      status: error.status,
      clearSession: error.clearSession,
    };
  }
  if (error instanceof SyntaxError) {
    return {
      error: "Library service returned an invalid response.",
      status: 502,
      clearSession: false,
    };
  }
  if (error instanceof TypeError && error.message.toLowerCase().includes("fetch failed")) {
    return {
      error: "Unable to reach the library service right now.",
      status: 502,
      clearSession: false,
    };
  }
  return {
    error: "Failed to load your library from the configured OPDS endpoint.",
    status: 500,
    clearSession: false,
  };
};

const resolveAbsoluteUrl = (href: string, baseUrl: string): string => {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
};

const isBrowserReadablePublication = (publication: Record<string, unknown>): boolean => {
  const links = Array.isArray(publication.links)
    ? (publication.links as Array<Record<string, unknown>>)
    : [];

  return links.some((link) => {
    const type = String(link.type ?? "");
    if (type.includes("application/webpub+json") || type.includes("application/epub+zip")) {
      return true;
    }

    const properties =
      typeof link.properties === "object" && link.properties !== null
        ? (link.properties as Record<string, unknown>)
        : null;
    const indirect = Array.isArray(properties?.indirectAcquisition)
      ? (properties.indirectAcquisition as Array<Record<string, unknown>>)
      : [];

    return indirect.some((entry) => String(entry.type ?? "").includes("application/epub+zip"));
  });
};

const extractAssetIdFromHref = (href: string, baseUrl: string): string | null => {
  const absoluteHref = resolveAbsoluteUrl(href, baseUrl);
  const decodedHref = decodeURIComponent(absoluteHref);
  const acquireIndex = decodedHref.lastIndexOf("/acquire/");
  if (acquireIndex === -1) {
    return null;
  }
  return decodedHref.slice(acquireIndex + "/acquire/".length).split(/[/?#]/)[0] ?? null;
};

const parseTokenFromLoginResponse = (responseJson: Record<string, unknown>): string | null => {
  const tokenKeys = ["token", "accessToken", "access_token", "jwt"];
  for (const key of tokenKeys) {
    const token = responseJson[key];
    if (typeof token === "string" && token.length > 0) {
      return token;
    }
  }
  const nested = responseJson.data;
  if (typeof nested === "object" && nested !== null) {
    for (const key of tokenKeys) {
      const token = (nested as Record<string, unknown>)[key];
      if (typeof token === "string" && token.length > 0) {
        return token;
      }
    }
  }
  return null;
};

const parseEntitlementIds = (payload: unknown): Set<string> => {
  const data = Array.isArray(payload)
    ? payload
    : typeof payload === "object" &&
        payload !== null &&
        Array.isArray((payload as { items?: unknown[] }).items)
      ? (payload as { items: unknown[] }).items
      : [];

  const ids = new Set<string>();
  data.forEach((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return;
    }
    const record = entry as Record<string, unknown>;
    const values = [record.assetId, record.id, record.identifier, record.publicationId];
    values.forEach((value) => {
      if (typeof value === "string" && value.length > 0) {
        ids.add(value);
      }
    });
  });
  return ids;
};

const getPublicationManifestUrl = (
  publication: Record<string, unknown>,
  baseUrl: string,
  publicationId: string | null,
  readerBaseUrl: string,
): string | null => {
  if (publicationId) {
    return new URL(`/api/library/pub/${publicationId}/manifest.json`, readerBaseUrl).toString();
  }

  const links = Array.isArray(publication.links)
    ? (publication.links as Array<Record<string, unknown>>)
    : [];
  const preferred = links.find((link) => {
    const type = String(link.type ?? "");
    const rel = Array.isArray(link.rel) ? link.rel.map(String) : [String(link.rel ?? "")];
    return rel.includes("self") && type.includes("application/webpub+json");
  });
  const href = preferred?.href;
  if (typeof href !== "string" || !href) {
    return null;
  }
  return resolveAbsoluteUrl(href, baseUrl);
};

const getPublicationAssetId = (publication: Record<string, unknown>, baseUrl: string): string | null => {
  const links = Array.isArray(publication.links)
    ? (publication.links as Array<Record<string, unknown>>)
    : [];
  const acquireLink = links.find((link) => {
    const rel = Array.isArray(link.rel) ? link.rel.map(String) : [String(link.rel ?? "")];
    return rel.includes("http://opds-spec.org/acquisition");
  });
  const href = typeof acquireLink?.href === "string" ? acquireLink.href : null;
  if (!href) {
    return null;
  }
  return extractAssetIdFromHref(href, baseUrl);
};

const getPublicationId = (publication: Record<string, unknown>, baseUrl: string): string | null => {
  const links = Array.isArray(publication.links)
    ? (publication.links as Array<Record<string, unknown>>)
    : [];
  const selfLink = links.find((link) => {
    const rel = Array.isArray(link.rel) ? link.rel.map(String) : [String(link.rel ?? "")];
    return rel.includes("self");
  });
  const href = typeof selfLink?.href === "string" ? selfLink.href : null;
  if (!href) {
    return null;
  }
  const absoluteHref = resolveAbsoluteUrl(href, baseUrl);
  const marker = "/opds/publications/";
  const idx = absoluteHref.indexOf(marker);
  if (idx === -1) {
    return null;
  }
  return absoluteHref.slice(idx + marker.length).split(/[/?#]/)[0] ?? null;
};

const getPublicationCoverUrl = (
  publication: Record<string, unknown>,
  baseUrl: string,
  publicationId: string | null,
  readerBaseUrl: string,
): string | null => {
  if (publicationId) {
    return new URL(`/api/library/pub/${publicationId}/cover`, readerBaseUrl).toString();
  }

  const images = Array.isArray(publication.images)
    ? (publication.images as Array<Record<string, unknown>>)
    : [];
  const imageHref = images.find((image) => typeof image.href === "string")?.href;
  if (typeof imageHref === "string" && imageHref) {
    return resolveAbsoluteUrl(imageHref, baseUrl);
  }
  return null;
};

const getPublicationAuthor = (metadata: Record<string, unknown>): string | null => {
  const author = metadata.author;
  if (typeof author === "string" && author.trim()) {
    return author;
  }
  if (!Array.isArray(author)) {
    return null;
  }
  for (const candidate of author) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
    if (typeof candidate === "object" && candidate !== null) {
      const name = (candidate as { name?: unknown }).name;
      if (typeof name === "string" && name.trim()) {
        return name;
      }
    }
  }
  return null;
};

const getPublicationsFeedUrl = (
  payload: unknown,
  sourceUrl: string,
  config: LibraryConfig,
): string | null => {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const root = payload as Record<string, unknown>;
  if (Array.isArray(root.publications)) {
    return null;
  }
  const links = [
    ...(Array.isArray(root.navigation) ? root.navigation : []),
    ...(Array.isArray(root.links) ? root.links : []),
  ] as Array<Record<string, unknown>>;

  const feedLink = links.find((link) => {
    const href = typeof link.href === "string" ? link.href : "";
    const rel = Array.isArray(link.rel) ? link.rel.map(String) : [String(link.rel ?? "")];
    return href.includes("/opds/publications") || rel.includes("http://opds-spec.org/sort/new");
  });
  const href = typeof feedLink?.href === "string" ? feedLink.href : null;
  if (!href) {
    return null;
  }
  return resolvePublicationsFeedUrl(href, sourceUrl, config);
};

const getCatalogCandidateUrls = (config: LibraryConfig): string[] =>
  Array.from(
    new Set([
      config.catalogUrl,
      new URL("/opds", config.apiBaseUrl).toString(),
      new URL("/opds/publications", config.apiBaseUrl).toString(),
    ]),
  );

const resolvePublicationsFeedUrl = (
  href: string,
  sourceUrl: string,
  config: LibraryConfig,
): string | null => {
  const configuredCatalogOrigins = new Set(
    [config.apiBaseUrl, config.catalogUrl].map((value) => new URL(value).origin),
  );
  try {
    const source = new URL(sourceUrl);
    const candidate = new URL(href, source);
    if (
      !["http:", "https:"].includes(candidate.protocol) ||
      candidate.username ||
      candidate.password ||
      !configuredCatalogOrigins.has(candidate.origin) ||
      (source.protocol === "https:" && candidate.protocol !== "https:")
    ) {
      return null;
    }
    return candidate.toString();
  } catch {
    return null;
  }
};

const fetchCatalogPayload = async (
  ctx: LibraryContext,
  auth: UpstreamAuth,
): Promise<{ payload: unknown; sourceUrl: string }> => {
  let lastNotFoundError: LibraryRequestError | null = null;
  const catalogInit = {
    headers: { accept: "application/opds+json,application/json" },
    redirect: "manual" as const,
  };

  for (const candidateUrl of getCatalogCandidateUrls(ctx.config)) {
    const catalogResponse = await ctx.upstream(candidateUrl, catalogInit, auth);
    if (!catalogResponse.ok) {
      if (catalogResponse.status === 404) {
        lastNotFoundError = toLibraryRequestError("Catalog", catalogResponse.status);
        continue;
      }
      throw toLibraryRequestError("Catalog", catalogResponse.status);
    }

    const catalogJson = await catalogResponse.json();
    const publicationsFeedUrl = getPublicationsFeedUrl(catalogJson, candidateUrl, ctx.config);
    if (publicationsFeedUrl === null) {
      return { payload: catalogJson, sourceUrl: candidateUrl };
    }

    const publicationsResponse = await ctx.upstream(publicationsFeedUrl, catalogInit, auth);
    if (!publicationsResponse.ok) {
      if (publicationsResponse.status === 404) {
        lastNotFoundError = toLibraryRequestError("Catalog publications", publicationsResponse.status);
        continue;
      }
      throw toLibraryRequestError("Catalog publications", publicationsResponse.status);
    }

    return {
      payload: await publicationsResponse.json(),
      sourceUrl: publicationsFeedUrl,
    };
  }

  throw lastNotFoundError ?? new LibraryRequestError("Catalog request failed.", 502);
};

const parseCatalog = (
  payload: unknown,
  sourceUrl: string,
  readerBaseUrl: string,
): CatalogItem[] => {
  if (typeof payload !== "object" || payload === null) {
    return [];
  }
  const root = payload as Record<string, unknown>;
  if (!Array.isArray(root.publications)) {
    return [];
  }
  return root.publications.map((entry) => {
    const publication = entry as Record<string, unknown>;
    const metadata =
      typeof publication.metadata === "object" && publication.metadata !== null
        ? (publication.metadata as Record<string, unknown>)
        : {};
    const identifier =
      typeof metadata.identifier === "string" ? metadata.identifier : null;
    const title =
      typeof metadata.title === "string" && metadata.title
        ? metadata.title
        : "Untitled publication";
    const publicationId = getPublicationId(publication, sourceUrl);
    const canOpenInBrowser = isBrowserReadablePublication(publication);

    return {
      title,
      identifier,
      assetId: getPublicationAssetId(publication, sourceUrl),
      publicationId,
      coverUrl: getPublicationCoverUrl(
        publication,
        sourceUrl,
        publicationId,
        readerBaseUrl,
      ),
      author: getPublicationAuthor(metadata),
      manifestUrl: canOpenInBrowser
        ? getPublicationManifestUrl(
            publication,
            sourceUrl,
            publicationId,
            readerBaseUrl,
          )
        : null,
    };
  });
};


const loadLibrary = async (
  ctx: LibraryContext,
  auth: UpstreamAuth,
  readerBaseUrl: string,
): Promise<CatalogItem[]> => {
  const entitlementsUrl = new URL(
    brandingConfig.authHandoff.entitlementsEndpoint,
    ctx.config.apiBaseUrl,
  ).toString();
  const [catalogPayload, entitlementResponse] = await Promise.all([
    fetchCatalogPayload(ctx, auth),
    ctx.upstream(entitlementsUrl, { redirect: "manual" }, auth),
  ]);
  if (!entitlementResponse.ok) {
    throw toLibraryRequestError("Entitlements", entitlementResponse.status);
  }

  const entitlementJson = await entitlementResponse.json();
  const entitlementIds = parseEntitlementIds(entitlementJson);
  const parsedCatalog = parseCatalog(
    catalogPayload.payload,
    catalogPayload.sourceUrl,
    readerBaseUrl,
  );

  if (!brandingConfig.library.requireEntitlement) {
    return parsedCatalog.slice(0, brandingConfig.library.maxItems);
  }

  return parsedCatalog.filter((item) => {
    if (item.assetId && entitlementIds.has(item.assetId)) {
      return true;
    }
    if (item.publicationId && entitlementIds.has(item.publicationId)) {
      return true;
    }
    if (item.identifier && entitlementIds.has(item.identifier)) {
      return true;
    }
    return false;
  }).slice(0, brandingConfig.library.maxItems);
};

/** Signs in and returns the library. `readerBaseUrl` is the origin the page uses. */
export async function signIn(
  request: Request,
  ctx: LibraryContext,
  readerBaseUrl: string,
): Promise<LibraryResult> {
  try {
    const body = (await request.json()) as {
      email?: string;
      username?: string;
      password?: string;
    };
    const email = (body.email ?? body.username ?? "").trim();
    const password = body.password;
    if (!email || !password) {
      return jsonResult({ error: "Email and password are required." }, { status: 400 });
    }

    const loginResponse = await ctx.upstream(
      ctx.config.authUrl,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      },
      "none",
    );
    if (!loginResponse.ok) {
      return jsonResult({ error: "Login failed. Check your credentials." }, { status: 401 });
    }

    const loginJson = (await loginResponse.json()) as Record<string, unknown>;
    const token = parseTokenFromLoginResponse(loginJson);
    if (!token) {
      return jsonResult(
        { error: "Login succeeded but token was missing from response." },
        { status: 502 },
      );
    }

    const books = await loadLibrary(ctx, { bearer: token }, readerBaseUrl);
    return jsonResult({ books }, undefined, { set: token });
  } catch (error) {
    const payload = toErrorPayload(error);
    return jsonResult({ error: payload.error }, { status: payload.status });
  }
}

export async function restoreSession(
  ctx: LibraryContext,
  readerBaseUrl: string,
): Promise<LibraryResult> {
  if (!ctx.hasSession) {
    return noSessionResult();
  }

  try {
    const books = await loadLibrary(ctx, "session", readerBaseUrl);
    return jsonResult({ books });
  } catch (error) {
    const payload = toErrorPayload(error);
    return jsonResult(
      { error: payload.error },
      { status: payload.status },
      payload.clearSession ? { clear: true } : undefined,
    );
  }
}

export function signOut(): LibraryResult {
  return jsonResult({ ok: true }, undefined, { clear: true });
}
