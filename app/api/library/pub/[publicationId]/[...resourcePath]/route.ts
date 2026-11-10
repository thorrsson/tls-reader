import { NextRequest } from "next/server";
import { createLibraryContext, toNextResponse } from "@/lib/library/next-adapter";
import { getPublicationResource } from "@/lib/library/publication";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ publicationId: string; resourcePath: string[] }> },
) {
  const { publicationId, resourcePath } = await params;
  const result = await getPublicationResource(
    createLibraryContext(request),
    publicationId,
    resourcePath,
    request.nextUrl.search,
  );
  return toNextResponse(request, result);
}
