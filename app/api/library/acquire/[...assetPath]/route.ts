import { NextRequest, NextResponse } from "next/server";
import brandingConfig from "@/config/thorium-web/branding.local.json";

const apiBaseUrl = process.env.NEXT_PUBLIC_TLS_API_BASE_URL ?? "http://localhost:8080";
const SESSION_COOKIE = "tls_reader_token";

const resolveAssetId = (assetPath: string[]): string | null => {
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ assetPath: string[] }> },
) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: "No active session." }, { status: 401 });
  }

  const { assetPath } = await params;
  const assetId = resolveAssetId(assetPath ?? []);
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
      accept: "application/vnd.readium.lcp.license.v1.0+json,application/json",
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
