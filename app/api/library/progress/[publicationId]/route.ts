import { NextRequest } from "next/server";
import { createLibraryContext, toNextResponse } from "@/lib/library/next-adapter";
import { getProgress, saveProgress } from "@/lib/library/progress";

type Params = { params: Promise<{ publicationId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { publicationId } = await params;
  return toNextResponse(request, await getProgress(createLibraryContext(request), publicationId));
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { publicationId } = await params;
  return toNextResponse(
    request,
    await saveProgress(request, createLibraryContext(request), publicationId),
  );
}
