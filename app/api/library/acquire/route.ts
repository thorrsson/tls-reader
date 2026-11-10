import { NextRequest } from "next/server";
import { acquireLicense, normalizeAssetIdParam } from "@/lib/library/acquire";
import { createLibraryContext, toNextResponse } from "@/lib/library/next-adapter";

export async function GET(request: NextRequest) {
  const ctx = createLibraryContext(request);
  const assetId = ctx.hasSession
    ? normalizeAssetIdParam(request.nextUrl.searchParams.get("assetId") ?? "")
    : null;
  const result = await acquireLicense(
    ctx,
    assetId,
    "application/vnd.readium.lcp.license.v1.0+json,application/json,text/plain",
  );
  return toNextResponse(request, result);
}
