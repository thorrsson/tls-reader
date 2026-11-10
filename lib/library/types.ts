/**
 * Transport-neutral contracts for the library backend-for-frontend.
 *
 * The same handlers run inside Next route handlers (desktop/web, session token
 * in an httpOnly cookie) and inside the mobile WebView (session token held by
 * native code). Handlers never see the stored session token: they ask the
 * transport to authenticate an upstream request instead.
 */

export type LibraryConfig = {
  apiBaseUrl: string;
  authUrl: string;
  catalogUrl: string;
};

/**
 * - `none`: send no credentials.
 * - `session`: attach the stored session token.
 * - `{ bearer }`: attach a token that has not been stored yet (login).
 */
export type UpstreamAuth = "none" | "session" | { bearer: string };

export type UpstreamInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  redirect?: "manual";
};

export type Upstream = (url: string, init: UpstreamInit, auth: UpstreamAuth) => Promise<Response>;

export type LibraryContext = {
  config: LibraryConfig;
  hasSession: boolean;
  upstream: Upstream;
};

export type SessionEffect = { set: string } | { clear: true };

export type LibraryResult = {
  response: Response;
  session?: SessionEffect;
};

export const jsonResult = (
  body: unknown,
  init?: ResponseInit,
  session?: SessionEffect,
): LibraryResult => ({ response: Response.json(body, init), session });

export const noSessionResult = (): LibraryResult =>
  jsonResult({ error: "No active session." }, { status: 401 });

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;
