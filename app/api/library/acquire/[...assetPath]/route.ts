import { NextRequest } from "next/server";
import { acquireLicense, resolveAssetIdFromPath } from "@/lib/library/acquire";
import { createLibraryContext, toNextResponse } from "@/lib/library/next-adapter";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assetPath: string[] }> },
) {
  const { assetPath } = await params;
  const result = await acquireLicense(
    createLibraryContext(request),
    resolveAssetIdFromPath(assetPath ?? []),
    "application/vnd.readium.lcp.license.v1.0+json,application/json",
  );
  return toNextResponse(request, result);
}
