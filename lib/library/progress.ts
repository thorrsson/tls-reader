import { jsonResult, noSessionResult, type LibraryContext, type LibraryResult } from "./types";

type LocatorPayload = {
  locator?: Record<string, unknown>;
  updatedAt?: string;
};

const mapUpstreamError = async (response: Response, fallback: string): Promise<string> => {
  const text = (await response.text()).trim();
  return text || fallback;
};

const decodePublicationId = (raw: string): string => decodeURIComponent(raw).trim();

const positionUrl = (ctx: LibraryContext, publicationId: string): string =>
  `${ctx.config.apiBaseUrl}/my/publications/${encodeURIComponent(publicationId)}/position`;

const unreachable = (): LibraryResult =>
  jsonResult({ error: "Unable to reach the publication service right now." }, { status: 502 });

export async function getProgress(
  ctx: LibraryContext,
  rawPublicationId: string,
): Promise<LibraryResult> {
  if (!ctx.hasSession) {
    return noSessionResult();
  }

  const publicationId = decodePublicationId(rawPublicationId);
  if (!publicationId) {
    return jsonResult({ error: "Missing publication ID." }, { status: 400 });
  }

  try {
    const response = await ctx.upstream(
      positionUrl(ctx, publicationId),
      { method: "GET", headers: { accept: "application/json" } },
      "session",
    );

    if (response.status === 404) {
      return jsonResult({ locator: null });
    }
    if (!response.ok) {
      return jsonResult(
        { error: await mapUpstreamError(response, "Failed to load reading position.") },
        { status: response.status },
      );
    }

    const payload = (await response.json()) as LocatorPayload;
    return jsonResult({ locator: payload.locator ?? null, updatedAt: payload.updatedAt });
  } catch {
    return unreachable();
  }
}

export async function saveProgress(
  request: Request,
  ctx: LibraryContext,
  rawPublicationId: string,
): Promise<LibraryResult> {
  if (!ctx.hasSession) {
    return noSessionResult();
  }

  const publicationId = decodePublicationId(rawPublicationId);
  if (!publicationId) {
    return jsonResult({ error: "Missing publication ID." }, { status: 400 });
  }

  let payload: LocatorPayload;
  try {
    payload = (await request.json()) as LocatorPayload;
  } catch {
    return jsonResult({ error: "Invalid request body." }, { status: 400 });
  }

  if (!payload.locator || typeof payload.locator !== "object") {
    return jsonResult({ error: "locator is required." }, { status: 400 });
  }

  try {
    const response = await ctx.upstream(
      positionUrl(ctx, publicationId),
      {
        method: "PUT",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ locator: payload.locator }),
      },
      "session",
    );

    if (!response.ok) {
      return jsonResult(
        { error: await mapUpstreamError(response, "Failed to save reading position.") },
        { status: response.status },
      );
    }

    return jsonResult((await response.json()) as Record<string, unknown>);
  } catch {
    return unreachable();
  }
}
