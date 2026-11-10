import { Capacitor, registerPlugin } from "@capacitor/core";
import { acquireLicense, normalizeAssetIdParam, resolveAssetIdFromPath } from "./acquire";
import { getProgress, saveProgress } from "./progress";
import { getPublicationResource } from "./publication";
import { restoreSession, signIn, signOut } from "./session";
import type { LibraryConfig, LibraryContext, LibraryResult, Upstream } from "./types";

/**
 * In the iOS/Android shells there is no Next server. This module serves the
 * JSON `/api/library/*` endpoints inside the WebView with the shared handlers,
 * while the native `TlsNative` plugin owns the session token and performs every
 * upstream request. Other publication resources (chapters, images, covers) are
 * proxied by native request interception, so they also work for iframe and
 * `<img>` loads that never pass through `window.fetch`.
 */

type NativeResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

type NativeRequest = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  auth: "none" | "session" | "bearer";
  bearer?: string;
  followRedirects: boolean;
};

export interface TlsNativePlugin {
  getConfig(): Promise<LibraryConfig>;
  hasSession(): Promise<{ value: boolean }>;
  setToken(options: { token: string }): Promise<void>;
  clearToken(): Promise<void>;
  request(options: NativeRequest): Promise<NativeResponse>;
}

type Route = {
  method: string;
  pattern: RegExp;
  handle: (
    request: Request,
    ctx: LibraryContext,
    url: URL,
    segments: string[],
    readerBaseUrl: string,
  ) => Promise<LibraryResult> | LibraryResult;
};

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);
const LCP_ACCEPT = "application/vnd.readium.lcp.license.v1.0+json,application/json";

const decodeSegment = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const routes: Route[] = [
  {
    method: "GET",
    pattern: /^\/api\/library\/session\/?$/,
    handle: (_request, ctx, _url, _segments, base) => restoreSession(ctx, base),
  },
  {
    method: "POST",
    pattern: /^\/api\/library\/session\/?$/,
    handle: (request, ctx, _url, _segments, base) => signIn(request, ctx, base),
  },
  {
    method: "DELETE",
    pattern: /^\/api\/library\/session\/?$/,
    handle: () => signOut(),
  },
  {
    method: "GET",
    pattern: /^\/api\/library\/progress\/([^/]+)\/?$/,
    handle: (_request, ctx, _url, [id]) => getProgress(ctx, id),
  },
  {
    method: "PUT",
    pattern: /^\/api\/library\/progress\/([^/]+)\/?$/,
    handle: (request, ctx, _url, [id]) => saveProgress(request, ctx, id),
  },
  {
    method: "GET",
    pattern: /^\/api\/library\/acquire\/?$/,
    handle: (_request, ctx, url) =>
      acquireLicense(
        ctx,
        ctx.hasSession ? normalizeAssetIdParam(url.searchParams.get("assetId") ?? "") : null,
        `${LCP_ACCEPT},text/plain`,
      ),
  },
  {
    method: "GET",
    pattern: /^\/api\/library\/acquire\/(.+)$/,
    handle: (_request, ctx, _url, [assetPath]) =>
      acquireLicense(ctx, resolveAssetIdFromPath(assetPath.split("/").map(decodeSegment)), LCP_ACCEPT),
  },
  {
    // Manifests and synthesized position lists are rewritten by the shared
    // handler; every other publication resource is proxied natively.
    method: "GET",
    pattern: /^\/api\/library\/pub\/([^/]+)\/(manifest\.json|positions-fallback\.json)$/,
    handle: (_request, ctx, url, [id, resource]) =>
      getPublicationResource(ctx, id, [resource], url.search),
  },
];

const toResponse = (native: NativeResponse): Response =>
  new Response(NULL_BODY_STATUSES.has(native.status) ? null : native.body, {
    status: native.status,
    headers: native.headers,
  });

export const createNativeUpstream = (plugin: TlsNativePlugin): Upstream => async (url, init, auth) => {
  let native: NativeResponse;
  try {
    native = await plugin.request({
      url,
      method: init.method ?? "GET",
      headers: init.headers ?? {},
      body: init.body,
      auth: typeof auth === "object" ? "bearer" : auth,
      bearer: typeof auth === "object" ? auth.bearer : undefined,
      followRedirects: init.redirect !== "manual",
    });
  } catch {
    // Mirror `fetch` so the shared handlers map this to "service unreachable".
    throw new TypeError("fetch failed");
  }
  return toResponse(native);
};

export const createMobileLibraryFetch = (
  plugin: TlsNativePlugin,
  fallback: typeof fetch,
  origin: string,
): typeof fetch => {
  // `URL.origin` is "null" for custom schemes such as capacitor://, so compare
  // scheme and host explicitly.
  const base = new URL(origin);
  const readerBaseUrl = `${base.protocol}//${base.host}`;
  let config: Promise<LibraryConfig> | null = null;
  const upstream = createNativeUpstream(plugin);

  return async (input, init) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    let url: URL;
    try {
      url = new URL(rawUrl, origin);
    } catch {
      return fallback(input, init);
    }
    if (url.protocol !== base.protocol || url.host !== base.host) {
      return fallback(input, init);
    }

    for (const route of routes) {
      const match = route.method === method ? route.pattern.exec(url.pathname) : null;
      if (!match) {
        continue;
      }
      config ??= plugin.getConfig().catch((error) => {
        config = null;
        throw error;
      });
      const ctx: LibraryContext = {
        config: await config,
        hasSession: (await plugin.hasSession()).value,
        upstream,
      };
      const segments = match.slice(1).map(decodeSegment);
      const request = input instanceof Request ? new Request(input, init) : new Request(url, init);
      const result = await route.handle(request, ctx, url, segments, readerBaseUrl);
      if (result.session && "set" in result.session) {
        await plugin.setToken({ token: result.session.set });
      } else if (result.session) {
        await plugin.clearToken();
      }
      return result.response;
    }

    return fallback(input, init);
  };
};

let installed = false;

/** Routes same-origin `/api/library/*` fetches through the native plugin. */
export function installMobileLibraryBridge(): void {
  if (installed || typeof window === "undefined" || !Capacitor.isNativePlatform()) {
    return;
  }
  installed = true;
  const plugin = registerPlugin<TlsNativePlugin>("TlsNative");
  window.fetch = createMobileLibraryFetch(plugin, window.fetch.bind(window), window.location.href);
  document.documentElement.dataset.platform = Capacitor.getPlatform();
}
