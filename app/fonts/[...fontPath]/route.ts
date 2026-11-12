import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const THORIUM_FONTS_DIR = path.join(
  process.cwd(),
  "node_modules",
  "@edrlab",
  "thorium-web",
  "dist",
  "fonts",
);

const CONTENT_TYPES: Record<string, string> = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".otf": "font/otf",
  ".ttf": "font/ttf",
};

const isSafeSegment = (value: string) =>
  value !== "." && value !== ".." && /^[A-Za-z0-9 ._-]+$/.test(value);

// Prerender every bundled font so static exports (mobile) contain them.
export async function generateStaticParams() {
  const entries = await readdir(THORIUM_FONTS_DIR, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && CONTENT_TYPES[path.extname(entry.name).toLowerCase()])
    .map((entry) => ({
      fontPath: path
        .relative(THORIUM_FONTS_DIR, path.join(entry.parentPath, entry.name))
        .split(path.sep),
    }))
    .filter(({ fontPath }) => fontPath.every(isSafeSegment));
}

type RouteContext = {
  params: Promise<{ fontPath: string[] }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { fontPath } = await context.params;

  if (
    !Array.isArray(fontPath) ||
    fontPath.length === 0 ||
    !fontPath.every(isSafeSegment)
  ) {
    return new Response("Not found", { status: 404 });
  }

  const ext = path.extname(fontPath[fontPath.length - 1]).toLowerCase();
  const contentType = CONTENT_TYPES[ext];
  if (!contentType) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = path.join(THORIUM_FONTS_DIR, ...fontPath);
  if (!filePath.startsWith(THORIUM_FONTS_DIR + path.sep)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const body = await readFile(filePath);
    return new Response(new Uint8Array(body), {
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
