import { readFile } from "node:fs/promises";
import path from "node:path";

const THORIUM_LOCALES_DIR = path.join(
  process.cwd(),
  "node_modules",
  "@edrlab",
  "thorium-web",
  "dist",
  "locales",
);

const isSafeLocale = (value: string) => /^[a-z]{2}(?:-[A-Z]{2})?$/.test(value);

const isSafeFile = (value: string) =>
  /^(?:thorium-web|thorium-shared)\.json$/.test(value);

const readerPreferencesFallbacks = {
  reader: {
    preferences: {
      title: "Preferences",
      fontSize: "Font size",
      text: "Text",
      themes: {
        title: "Themes",
        auto: "Auto",
        light: "Light",
        paper: "Paper",
        sepia: "Sepia",
        dark: "Dark",
        contrast1: "Contrast 1",
        contrast2: "Contrast 2",
        contrast3: "Contrast 3",
      },
      spacing: {
        title: "Spacing",
        presets: {
          title: "Presets",
          default: "Publisher",
          accessible: "Accessible",
          tight: "Tight",
          balanced: "Balanced",
          loose: "Loose",
          custom: "Custom",
        },
      },
      layout: {
        title: "Layout",
        paginated: "Paginated",
        scrolled: "Scrolled",
      },
      columns: {
        title: "Columns",
        auto: "Auto",
        single: {
          compact: "Single",
        },
        dual: {
          compact: "Double",
        },
      },
      textAlign: {
        title: "Text alignment",
        default: "Publisher",
        left: "Left",
        right: "Right",
        justify: "Justified",
      },
      fontFamily: {
        title: "Font",
        publisher: "Publisher",
        oldStyle: {
          descriptive: "Old style",
        },
        modern: {
          descriptive: "Modern",
        },
        humanist: {
          descriptive: "Humanist",
        },
        sans: "Sans serif",
        monospace: "Monospace",
      },
      lineHeight: {
        title: "Line height",
        default: "Publisher",
        small: "Small",
        medium: "Medium",
        large: "Large",
      },
      fontWeight: {
        title: "Font weight",
        normal: "Normal",
        bold: "Bold",
      },
      wordSpacing: "Word spacing",
      letterSpacing: "Letter spacing",
      paragraphSpacing: "Paragraph spacing",
      paragraphIndent: "Paragraph indent",
      zoom: "Zoom",
      publisherStyles: {
        label: "Use publisher styles",
      },
      textNormalization: {
        title: "Text normalization",
        label: "Normalize text",
      },
      hyphens: {
        title: "Hyphenation",
        label: "Enable hyphenation",
      },
      ligatures: {
        title: "Ligatures",
        label: "Enable ligatures",
      },
      noRuby: {
        title: "Ruby annotations",
        label: "Hide ruby annotations",
      },
    },
  },
} as const;

const readerProgressionFallbacks = {
  reader: {
    progression: {
      xOfY: {
        compact: "{{ x }} of {{ y }}",
        descriptive: "{{ x }} of {{ y }} ({{ z }})",
      },
    },
  },
} as const;

const readerSharedFallbacks = {
  reader: {
    ...readerProgressionFallbacks.reader,
    tableOfContents: {
      title: "Table of contents",
      emptyState: {
        title: "No table of contents",
        description: "A table of contents was not provided by the author.",
      },
    },
  },
} as const;

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fillMissingDeep = (
  target: Record<string, unknown>,
  fallback: Record<string, unknown>,
): void => {
  Object.entries(fallback).forEach(([key, fallbackValue]) => {
    const currentValue = target[key];
    if (isObjectRecord(fallbackValue)) {
      if (!isObjectRecord(currentValue)) {
        target[key] = {};
      }
      fillMissingDeep(
        target[key] as Record<string, unknown>,
        fallbackValue as Record<string, unknown>,
      );
      return;
    }

    if (typeof currentValue === "undefined") {
      target[key] = fallbackValue;
    }
  });
};

const getLocaleCandidates = (requestedLocale: string): string[] => {
  const candidates: string[] = [requestedLocale];
  const [baseLocale] = requestedLocale.split("-");

  if (baseLocale && baseLocale !== requestedLocale) {
    candidates.push(baseLocale);
  }

  if (baseLocale === "pt") {
    candidates.push("pt-PT", "pt-BR");
  }

  candidates.push("en");

  return candidates.filter(
    (candidate, index, all) =>
      isSafeLocale(candidate) && all.indexOf(candidate) === index,
  );
};

const readLocaleFile = async (
  localeCandidates: string[],
  file: string,
): Promise<string | null> => {
  for (const localeCandidate of localeCandidates) {
    const filePath = path.join(THORIUM_LOCALES_DIR, localeCandidate, file);
    try {
      return await readFile(filePath, "utf8");
    } catch {
      continue;
    }
  }
  return null;
};
type RouteContext = {
  params: Promise<{
    locale: string;
    file: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { locale, file } = await context.params;

  if (!isSafeLocale(locale) || !isSafeFile(file)) {
    return new Response("Not found", { status: 404 });
  }

  const rawBody = await readLocaleFile(getLocaleCandidates(locale), file);
  if (!rawBody) {
    return new Response("Not found", { status: 404 });
  }

  let body = rawBody;

  if (file === "thorium-web.json" || file === "thorium-shared.json") {
    const parsed = JSON.parse(rawBody) as unknown;
    if (isObjectRecord(parsed)) {
      if (file === "thorium-web.json") {
        fillMissingDeep(
          parsed,
          readerPreferencesFallbacks as unknown as Record<string, unknown>,
        );
        fillMissingDeep(
          parsed,
          readerProgressionFallbacks as unknown as Record<string, unknown>,
        );
      }

      if (file === "thorium-shared.json") {
        fillMissingDeep(
          parsed,
          readerSharedFallbacks as unknown as Record<string, unknown>,
        );
      }

      body = JSON.stringify(parsed);
    }
  }

  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
