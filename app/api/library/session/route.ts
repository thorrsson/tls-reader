import { NextRequest } from "next/server";
import {
  createLibraryContext,
  resolveReaderBaseUrl,
  toNextResponse,
} from "@/lib/library/next-adapter";
import { restoreSession, signIn, signOut } from "@/lib/library/session";

export async function POST(request: NextRequest) {
  const result = await signIn(request, createLibraryContext(request), resolveReaderBaseUrl(request));
  return toNextResponse(request, result);
}

export async function GET(request: NextRequest) {
  const result = await restoreSession(createLibraryContext(request), resolveReaderBaseUrl(request));
  return toNextResponse(request, result);
}

export async function DELETE(request: NextRequest) {
  return toNextResponse(request, signOut());
}
