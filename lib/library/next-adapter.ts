import { NextRequest, NextResponse } from "next/server";
import { integrationConfig } from "@/lib/branding";
import { SESSION_MAX_AGE_SECONDS, type LibraryContext, type LibraryResult, type Upstream } from "./types";

export const SESSION_COOKIE = "tls_reader_token";

const libraryConfig = {
  apiBaseUrl: integrationConfig.tlsApiBaseUrl,
  authUrl: integrationConfig.authUrl,
  catalogUrl: integrationConfig.catalogUrl,
};

const isReaderCookieSecure = (request: NextRequest): boolean => {
  const configured = process.env.TLS_READER_COOKIE_SECURE;
  if (configured === "true") {
    return true;
  }
  if (configured === "false") {
    return false;
  }
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const requestProto = request.nextUrl.protocol.replace(/:$/, "");
  return (forwardedProto ?? requestProto) === "https";
};

export const createLibraryContext = (request: NextRequest): LibraryContext => {
  const token = request.cookies.get(SESSION_COOKIE)?.value || null;
  const upstream: Upstream = (url, init, auth) => {
    const headers: Record<string, string> = { ...init.headers };
    if (auth === "session" && token) {
      headers.Authorization = `Bearer ${token}`;
    } else if (typeof auth === "object") {
      headers.Authorization = `Bearer ${auth.bearer}`;
    }
    return fetch(url, { ...init, headers });
  };
  return { config: libraryConfig, hasSession: token !== null, upstream };
};

export const toNextResponse = (request: NextRequest, result: LibraryResult): NextResponse => {
  const response = new NextResponse(result.response.body, {
    status: result.response.status,
    headers: result.response.headers,
  });
  if (result.session) {
    const isSet = "set" in result.session;
    response.cookies.set({
      name: SESSION_COOKIE,
      value: isSet ? (result.session as { set: string }).set : "",
      httpOnly: true,
      sameSite: "lax",
      secure: isReaderCookieSecure(request),
      path: "/",
      maxAge: isSet ? SESSION_MAX_AGE_SECONDS : 0,
    });
  }
  return response;
};

const getFirstForwardedValue = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  const first = value
    .split(",")
    .map((entry) => entry.trim())
    .find(Boolean);
  return first ?? null;
};

const resolveRequestOrigin = (request: NextRequest): string | null => {
  const host = getFirstForwardedValue(
    request.headers.get("x-forwarded-host") ?? request.headers.get("host"),
  );
  if (!host) {
    return null;
  }
  const proto =
    getFirstForwardedValue(request.headers.get("x-forwarded-proto")) ??
    request.nextUrl.protocol.replace(/:$/, "") ??
    "http";
  return `${proto}://${host}`;
};

// Build reader-facing manifest URLs against the origin the client actually used
// to reach this server so they stay same-origin with the page and don't trigger
// mixed-content failures behind HTTPS reverse proxies.
export const resolveReaderBaseUrl = (request: NextRequest): string => {
  const requestOrigin = resolveRequestOrigin(request);
  const explicit = process.env.NEXT_PUBLIC_TLS_BASE_READER_URL?.trim();
  if (explicit) {
    try {
      const explicitUrl = new URL(explicit);
      if (requestOrigin?.startsWith("https://") && explicitUrl.protocol === "http:") {
        return requestOrigin;
      }
      return explicitUrl.toString();
    } catch {
      return requestOrigin ?? explicit;
    }
  }
  return requestOrigin ?? "http://localhost:3000";
};
