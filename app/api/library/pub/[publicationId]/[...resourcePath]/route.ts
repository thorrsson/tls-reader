import { NextRequest, NextResponse } from "next/server";

const apiBaseUrl = process.env.NEXT_PUBLIC_TLS_API_BASE_URL ?? "http://localhost:8080";
const SESSION_COOKIE = "tls_reader_token";

class PublicationProxyError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PublicationProxyError";
    this.status = status;
  }
}

const mapPublicationProxyError = (error: unknown): { error: string; status: number } => {
  if (error instanceof PublicationProxyError) {
    return { error: error.message, status: error.status };
  }
  if (error instanceof SyntaxError) {
    return {
      error: "Publication service returned invalid JSON.",
      status: 502,
    };
  }
  if (error instanceof TypeError && error.message.toLowerCase().includes("fetch failed")) {
    return {
      error: "Unable to reach the publication service right now.",
      status: 502,
    };
  }
  return {
    error: "Failed to load publication resource.",
    status: 500,
  };
};

type ManifestLink = {
  href?: string;
  type?: string;
  rel?: string[] | string;
};

type WebPubManifest = {
  metadata?: {
    conformsTo?: string | string[];
    [key: string]: unknown;
  };
  links?: ManifestLink[];
  readingOrder?: ManifestLink[];
  resources?: ManifestLink[];
  toc?: Array<{ title: string; href: string }>;
  [key: string]: unknown;
};

type Locator = {
  href: string;
  type: string;
  locations: {
    progression: number;
    totalProgression: number;
    position: number;
  };
};

const normalizePublicationResourcePath = (value: string): string => {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    decoded = value;
  }

  return decoded
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
};

const decodeXmlEntities = (value: string): string =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");

const parseNcxToc = (
  ncxText: string,
  ncxPathInPublication: string,
): Array<{ title: string; href: string }> => {
  const tocEntries: Array<{ title: string; href: string }> = [];
  const tocDir = ncxPathInPublication.includes("/")
    ? ncxPathInPublication.slice(0, ncxPathInPublication.lastIndexOf("/") + 1)
    : "";
  const navPointPattern =
    /<navLabel>[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<\/navLabel>[\s\S]*?<content[^>]*\ssrc="([^"]+)"[^>]*\/?>/g;

  for (const match of ncxText.matchAll(navPointPattern)) {
    const rawTitle = decodeXmlEntities(match[1] ?? "").replace(/<[^>]+>/g, "").trim();
    const rawSrc = decodeXmlEntities(match[2] ?? "").trim();
    if (!rawTitle || !rawSrc) {
      continue;
    }

    const [srcPath, srcHash] = rawSrc.split("#");
    let resolvedPath = "";
    try {
      resolvedPath = new URL(srcPath, `https://publication.local/${tocDir}`).pathname.slice(1);
    } catch {
      continue;
    }
    if (!resolvedPath) {
      continue;
    }
    const proxiedHref = normalizePublicationResourcePath(resolvedPath);
    tocEntries.push({
      title: rawTitle,
      href: srcHash ? `${proxiedHref}#${srcHash}` : proxiedHref,
    });
  }

  return tocEntries;
};

const tryBuildPublicationResourceUrl = (href: string, publicationId: string): URL | null => {
  const upstreamManifestUrl = new URL(`/pub/${encodeURIComponent(publicationId)}/manifest.json`, apiBaseUrl);
  let candidateTocUrl: URL;
  try {
    candidateTocUrl = new URL(href, upstreamManifestUrl);
  } catch {
    return null;
  }

  const rawPublicationPath = candidateTocUrl.pathname.replace(/^.*\/pub\/[^/]+\//, "").replace(/^\/+/, "");
  if (!rawPublicationPath) {
    return null;
  }
  const normalizedTocPath = normalizePublicationResourcePath(rawPublicationPath);
  return new URL(`/pub/${encodeURIComponent(publicationId)}/${normalizedTocPath}`, apiBaseUrl);
};

const toReaderHref = (value: string, publicationId: string): string => {
  const [rawPath, rawHash = ""] = value.split("#");
  const publicationApiPath = `/pub/${encodeURIComponent(publicationId)}/`;
  const proxyApiPath = `/api/library/pub/${encodeURIComponent(publicationId)}/`;

  const finalize = (path: string) => {
    const normalized = normalizePublicationResourcePath(path).replace(/^\/+/, "");
    return rawHash ? `${normalized}#${rawHash}` : normalized;
  };

  if (rawPath.startsWith("http://") || rawPath.startsWith("https://")) {
    try {
      const parsed = new URL(rawPath);
      if (parsed.pathname.includes(proxyApiPath)) {
        return finalize(parsed.pathname.slice(parsed.pathname.indexOf(proxyApiPath) + proxyApiPath.length));
      }
      if (parsed.pathname.includes(publicationApiPath)) {
        return finalize(
          parsed.pathname.slice(parsed.pathname.indexOf(publicationApiPath) + publicationApiPath.length),
        );
      }
      return value;
    } catch {
      return value;
    }
  }

  if (rawPath.startsWith(proxyApiPath)) {
    return finalize(rawPath.slice(proxyApiPath.length));
  }
  if (rawPath.startsWith(publicationApiPath)) {
    return finalize(rawPath.slice(publicationApiPath.length));
  }
  if (rawPath.startsWith("/")) {
    return finalize(rawPath);
  }
  return finalize(rawPath);
};

const rewriteManifestUrls = (value: unknown, publicationId: string): unknown => {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rewriteManifestUrls(entry, publicationId));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        key === "href" && typeof entry === "string"
          ? toReaderHref(entry, publicationId)
          : rewriteManifestUrls(entry, publicationId),
      ]),
    );
  }
  return value;
};

const resolveManifestToc = async (
  manifest: WebPubManifest,
  publicationId: string,
  authToken: string,
): Promise<Array<{ title: string; href: string }>> => {
  if (Array.isArray(manifest.toc) && manifest.toc.length > 0) {
    return manifest.toc
      .map((entry) => {
        const href = typeof entry.href === "string" ? toReaderHref(entry.href, publicationId) : "";
        const title = typeof entry.title === "string" ? entry.title : "";
        if (!href || !title) {
          return null;
        }
        return { title, href };
      })
      .filter((entry): entry is { title: string; href: string } => entry !== null);
  }

  const entries = [
    ...(Array.isArray(manifest.resources) ? manifest.resources : []),
    ...(Array.isArray(manifest.readingOrder) ? manifest.readingOrder : []),
    ...(Array.isArray(manifest.links) ? manifest.links : []),
  ];

  const tocCandidate = entries.find((entry) => {
    const href = typeof entry.href === "string" ? entry.href : "";
    const type = String(entry.type ?? "");
    return href.toLowerCase().includes(".ncx") || type.includes("application/x-dtbncx+xml");
  });

  const href = typeof tocCandidate?.href === "string" ? tocCandidate.href : null;
  if (!href) {
    return [];
  }

  const tocUrl = tryBuildPublicationResourceUrl(href, publicationId);
  if (!tocUrl) {
    return [];
  }

  const tocResponse = await fetch(tocUrl, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      accept: "application/xml,text/xml,*/*",
    },
  });
  if (!tocResponse.ok) {
    return [];
  }

  const tocText = await tocResponse.text();
  let tocPathInPublication = tocUrl.pathname.replace(/^.*\/pub\/[^/]+\//, "").replace(/^\/+/, "");
  try {
    tocPathInPublication = decodeURIComponent(tocPathInPublication);
  } catch {
    tocPathInPublication = tocUrl.pathname.replace(/^.*\/pub\/[^/]+\//, "").replace(/^\/+/, "");
  }
  return parseNcxToc(tocText, tocPathInPublication).map((entry) => ({
    ...entry,
    href: toReaderHref(entry.href, publicationId),
  }));
};

/** Injects the Readium EPUB profile URI when `conformsTo` is absent.
 *  Most LCP/ReadiumJ backends omit it, which causes Thorium to fall back to
 *  the WebPub scroll reader — losing paginated arrows and TOC navigation. */
const EPUB_PROFILE_URI = "https://readium.org/webpub-manifest/profiles/epub";

const ensureEpubProfile = (manifest: WebPubManifest): WebPubManifest => {
  const meta = manifest.metadata as Record<string, unknown> | undefined;
  if (!meta) return manifest;
  const conformsTo = meta.conformsTo;
  if (conformsTo) return manifest;
  // Detect EPUB by presence of xhtml/epub spine items.
  const readingOrder = Array.isArray(manifest.readingOrder) ? manifest.readingOrder : [];
  const epubItems = readingOrder.filter((link) => {
    const href = typeof link.href === "string" ? link.href : "";
    const type = typeof link.type === "string" ? link.type : "";
    return href.includes(".xhtml") || type.includes("xhtml");
  });
  if (epubItems.length === 0) return manifest;
  return {
    ...manifest,
    metadata: { ...meta, conformsTo: EPUB_PROFILE_URI },
  };
};

const withSelfLink = (manifest: WebPubManifest): WebPubManifest => {
  const links = Array.isArray(manifest.links) ? [...manifest.links] : [];
  const nextLinks = links.filter((link) => {
    const relValues = Array.isArray(link.rel) ? link.rel.map(String) : [String(link.rel ?? "")];
    return !relValues.includes("self");
  });

  nextLinks.unshift({
    href: "manifest.json",
    type: "application/webpub+json",
    rel: ["self"],
  });

  return {
    ...manifest,
    links: nextLinks,
  };
};

const withPositionListLink = (manifest: WebPubManifest): WebPubManifest => {
  const links = Array.isArray(manifest.links) ? [...manifest.links] : [];
  const alreadyPresent = links.some(
    (link) => String(link.type ?? "") === "application/vnd.readium.position-list+json",
  );
  if (alreadyPresent) {
    return manifest;
  }

  links.push({
    href: "positions.json",
    type: "application/vnd.readium.position-list+json",
    rel: ["http://www.w3.org/ns/pub-manifest#locators"],
  });
  return {
    ...manifest,
    links,
  };
};

const hasReadableSpine = (manifest: WebPubManifest): boolean => {
  if (!Array.isArray(manifest.readingOrder) || manifest.readingOrder.length === 0) {
    return false;
  }

  return manifest.readingOrder.some((link) => {
    const href = typeof link.href === "string" ? link.href : "";
    return href.length > 0;
  });
};

const buildPositionListFromManifest = (manifest: WebPubManifest): { total: number; positions: Locator[] } => {
  const readingOrder = Array.isArray(manifest.readingOrder) ? manifest.readingOrder : [];
  const positions: Locator[] = readingOrder
    .map((entry, index) => {
      const href = typeof entry.href === "string" ? entry.href : null;
      if (!href) {
        return null;
      }
      const total = readingOrder.length;
      return {
        href,
        type: typeof entry.type === "string" ? entry.type : "application/xhtml+xml",
        locations: {
          progression: 0,
          totalProgression: total > 1 ? index / (total - 1) : 0,
          position: index + 1,
        },
      } satisfies Locator;
    })
    .filter((entry): entry is Locator => entry !== null);

  return {
    total: positions.length,
    positions,
  };
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ publicationId: string; resourcePath: string[] }> },
) {
  try {
    const { publicationId, resourcePath } = await params;
    if (!publicationId || !Array.isArray(resourcePath) || resourcePath.length === 0) {
      return NextResponse.json({ error: "Missing publication path." }, { status: 400 });
    }

    const token = request.cookies.get(SESSION_COOKIE)?.value ?? null;
    if (!token) {
      return NextResponse.json({ error: "No active session." }, { status: 401 });
    }

    const rawResourcePath = resourcePath.join("/");
    let decodedResourcePath = rawResourcePath;
    try {
      decodedResourcePath = decodeURIComponent(rawResourcePath);
    } catch {
      decodedResourcePath = rawResourcePath;
    }

    const normalizedResourcePath = decodedResourcePath
      .split("/")
      .filter(Boolean)
      .map((part) => encodeURIComponent(part))
      .join("/");

    const targetPath = `/pub/${encodeURIComponent(publicationId)}/${normalizedResourcePath}`;
    const targetUrl = new URL(targetPath, apiBaseUrl);
    request.nextUrl.searchParams.forEach((value, key) => {
      targetUrl.searchParams.set(key, value);
    });

    if (decodedResourcePath === "positions.json") {
      const manifestUrl = new URL(`/pub/${encodeURIComponent(publicationId)}/manifest.json`, apiBaseUrl);
      const manifestUpstream = await fetch(manifestUrl.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          accept: "application/webpub+json,application/json",
        },
      });
      if (!manifestUpstream.ok) {
        const errorBody = await manifestUpstream.text();
        return NextResponse.json(
          { error: errorBody || `Publication request failed (${manifestUpstream.status}).` },
          { status: manifestUpstream.status },
        );
      }

      const rawManifest = (await manifestUpstream.json()) as WebPubManifest;
      const rewrittenManifest = rewriteManifestUrls(rawManifest, publicationId) as WebPubManifest;
      return NextResponse.json(buildPositionListFromManifest(rewrittenManifest), {
        status: 200,
        headers: {
          "cache-control": "no-cache",
          "content-type": "application/vnd.readium.position-list+json",
        },
      });
    }

    const upstream = await fetch(targetUrl.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        accept: "*/*",
      },
    });

    if (!upstream.ok) {
      const errorBody = await upstream.text();
      const response = NextResponse.json(
        { error: errorBody || `Publication request failed (${upstream.status}).` },
        { status: upstream.status },
      );
      if (upstream.status === 401 || upstream.status === 403) {
        response.cookies.set({
          name: SESSION_COOKIE,
          value: "",
          httpOnly: true,
          sameSite: "lax",
          secure: request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
          path: "/",
          maxAge: 0,
        });
      }
      return response;
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    if (decodedResourcePath === "manifest.json" && contentType.includes("json")) {
      const manifest = (await upstream.json()) as WebPubManifest;
      if (!hasReadableSpine(manifest)) {
        throw new PublicationProxyError("Publication manifest is missing a readable spine.", 502);
      }
      const rewrittenManifest = rewriteManifestUrls(manifest, publicationId) as WebPubManifest;
      const resolvedToc = await resolveManifestToc(manifest, publicationId, token);
      if (resolvedToc.length > 0) {
        rewrittenManifest.toc = resolvedToc;
      } else if (Array.isArray(rewrittenManifest.toc)) {
        // Ensure any existing toc entries (from rewriteManifestUrls pass-through)
        // are also in publication-relative href form; rewriteManifestUrls converts the hrefs,
        // so this is a safety pass in case the toc wasn't fully converted.
        rewrittenManifest.toc = rewrittenManifest.toc
          .map((entry) => {
            if (typeof entry !== "object" || entry === null) {
              return null;
            }
            const tocEntry = entry as Record<string, unknown>;
            const title = typeof tocEntry.title === "string" ? tocEntry.title : "";
            const hrefValue = typeof tocEntry.href === "string" ? toReaderHref(tocEntry.href, publicationId) : "";
            if (!title || !hrefValue) {
              return null;
            }
            return {
              title,
              href: hrefValue,
            };
          })
          .filter((entry): entry is { title: string; href: string } => entry !== null);
      }
      const profileManifest = ensureEpubProfile(rewrittenManifest);
      const selfLinkedManifest = withSelfLink(profileManifest);
      const normalizedManifest = withPositionListLink(selfLinkedManifest);

      return NextResponse.json(normalizedManifest, {
        status: 200,
        headers: {
          "content-type": contentType,
        },
      });
    }

    const body = await upstream.arrayBuffer();
    return new NextResponse(body, {
      status: 200,
      headers: {
        "content-type": contentType || "application/octet-stream",
        "cache-control": upstream.headers.get("cache-control") ?? "no-cache",
      },
    });
  } catch (error) {
    const payload = mapPublicationProxyError(error);
    return NextResponse.json({ error: payload.error }, { status: payload.status });
  }
}
