import brandingConfig from "@/config/thorium-web/branding.local.json";
import { jsonResult, noSessionResult, type LibraryContext, type LibraryResult } from "./types";

/** Extracts an asset ID from `?assetId=` values, which may be a bare ID or an acquire URL. */
export const normalizeAssetIdParam = (raw: string): string | null => {
  const decoded = decodeURIComponent(raw).trim();
  if (!decoded) {
    return null;
  }
  const marker = "/acquire/";
  const idx = decoded.lastIndexOf(marker);
  const candidate = idx >= 0 ? decoded.slice(idx + marker.length) : decoded;
  const cleaned = candidate.split(/[/?#]/)[0]?.split("/").filter(Boolean).pop() ?? "";
  return cleaned || null;
};

/** Extracts an asset ID from `/api/library/acquire/<...assetPath>` segments. */
export const resolveAssetIdFromPath = (assetPath: string[]): string | null => {
  const joined = decodeURIComponent(assetPath.join("/"));
  const marker = "/acquire/";
  const idx = joined.lastIndexOf(marker);
  const candidate = idx >= 0 ? joined.slice(idx + marker.length) : joined;
  const parts = candidate.split("/").filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  return parts[parts.length - 1] ?? null;
};

export async function acquireLicense(
  ctx: LibraryContext,
  assetId: string | null,
  accept: string,
): Promise<LibraryResult> {
  if (!ctx.hasSession) {
    return noSessionResult();
  }
  if (!assetId) {
    return jsonResult({ error: "Missing asset ID." }, { status: 400 });
  }

  const acquireEndpoint = brandingConfig.authHandoff.acquireEndpointTemplate.replace(
    "{assetId}",
    encodeURIComponent(assetId),
  );
  const acquireUrl = new URL(acquireEndpoint, ctx.config.apiBaseUrl).toString();

  const response = await ctx.upstream(acquireUrl, { headers: { accept } }, "session");

  if (!response.ok) {
    const errorBody = await response.text();
    return jsonResult(
      { error: errorBody || `Acquire request failed (${response.status}).` },
      { status: response.status },
    );
  }

  const body = await response.text();
  return {
    response: new Response(body, {
      status: 200,
      headers: {
        "content-type":
          response.headers.get("content-type") ??
          "application/vnd.readium.lcp.license.v1.0+json",
      },
    }),
  };
}
