import { NextRequest, NextResponse } from "next/server";

const apiBaseUrl = process.env.NEXT_PUBLIC_TLS_API_BASE_URL ?? "http://localhost:8080";
const SESSION_COOKIE = "tls_reader_token";

type LocatorPayload = {
  locator?: Record<string, unknown>;
  updatedAt?: string;
};

const getSessionToken = (request: NextRequest): string | null =>
  request.cookies.get(SESSION_COOKIE)?.value ?? null;

const mapUpstreamError = async (response: Response, fallback: string): Promise<string> => {
  const text = (await response.text()).trim();
  return text || fallback;
};

const getPublicationId = async (
  params: Promise<{ publicationId: string }>,
): Promise<string> => {
  const { publicationId } = await params;
  return decodeURIComponent(publicationId).trim();
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ publicationId: string }> },
) {
  const token = getSessionToken(request);
  if (!token) {
    return NextResponse.json({ error: "No active session." }, { status: 401 });
  }

  const publicationId = await getPublicationId(params);
  if (!publicationId) {
    return NextResponse.json({ error: "Missing publication ID." }, { status: 400 });
  }

  try {
    const response = await fetch(
      `${apiBaseUrl}/my/publications/${encodeURIComponent(publicationId)}/position`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          accept: "application/json",
        },
      },
    );

    if (response.status === 404) {
      return NextResponse.json({ locator: null });
    }
    if (!response.ok) {
      return NextResponse.json(
        { error: await mapUpstreamError(response, "Failed to load reading position.") },
        { status: response.status },
      );
    }

    const payload = (await response.json()) as LocatorPayload;
    return NextResponse.json({ locator: payload.locator ?? null, updatedAt: payload.updatedAt });
  } catch {
    return NextResponse.json(
      { error: "Unable to reach the publication service right now." },
      { status: 502 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ publicationId: string }> },
) {
  const token = getSessionToken(request);
  if (!token) {
    return NextResponse.json({ error: "No active session." }, { status: 401 });
  }

  const publicationId = await getPublicationId(params);
  if (!publicationId) {
    return NextResponse.json({ error: "Missing publication ID." }, { status: 400 });
  }

  let payload: LocatorPayload;
  try {
    payload = (await request.json()) as LocatorPayload;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!payload.locator || typeof payload.locator !== "object") {
    return NextResponse.json({ error: "locator is required." }, { status: 400 });
  }

  try {
    const response = await fetch(
      `${apiBaseUrl}/my/publications/${encodeURIComponent(publicationId)}/position`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ locator: payload.locator }),
      },
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: await mapUpstreamError(response, "Failed to save reading position.") },
        { status: response.status },
      );
    }

    const upstreamPayload = (await response.json()) as Record<string, unknown>;
    return NextResponse.json(upstreamPayload);
  } catch {
    return NextResponse.json(
      { error: "Unable to reach the publication service right now." },
      { status: 502 },
    );
  }
}
