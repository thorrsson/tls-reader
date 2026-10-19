import { NextRequest, NextResponse } from "next/server";
import brandingConfig from "@/config/thorium-web/branding.local.json";

const apiBaseUrl = process.env.NEXT_PUBLIC_TLS_API_BASE_URL ?? "http://localhost:8080";
const SESSION_COOKIE = "tls_reader_token";

const normalizeAssetId = (raw: string): string | null => {
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

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: "No active session." }, { status: 401 });
  }

  const rawAssetId = request.nextUrl.searchParams.get("assetId") ?? "";
  const assetId = normalizeAssetId(rawAssetId);
  if (!assetId) {
    return NextResponse.json({ error: "Missing asset ID." }, { status: 400 });
  }

  const acquireEndpoint = brandingConfig.authHandoff.acquireEndpointTemplate.replace(
    "{assetId}",
    encodeURIComponent(assetId),
  );
  const acquireUrl = new URL(acquireEndpoint, apiBaseUrl).toString();

  const response = await fetch(acquireUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      accept: "application/vnd.readium.lcp.license.v1.0+json,application/json,text/plain",
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    return NextResponse.json(
      { error: errorBody || `Acquire request failed (${response.status}).` },
      { status: response.status },
    );
  }

  const body = await response.text();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type":
        response.headers.get("content-type") ??
        "application/vnd.readium.lcp.license.v1.0+json",
    },
  });
}
