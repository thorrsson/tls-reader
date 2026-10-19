"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  StatefulGlobalPreferencesProvider,
  StatefulReaderWrapper,
  ThStoreProvider,
  usePublication,
} from "@edrlab/thorium-web/reader";
import type { PositionStorage } from "@edrlab/thorium-web/reader";
import {
  ThMemoryPreferencesAdapter,
  defaultPreferences,
} from "@edrlab/thorium-web/core/preferences";
import "@edrlab/thorium-web/reader/styles";
import "@edrlab/thorium-web/epub/styles";
import "@edrlab/thorium-web/webpub/styles";
import "@edrlab/thorium-web/misc/styles";

type ReaderRuntimeProps = {
  manifestUrl: string;
  publicationId: string | null;
};

type SerializedLocator = {
  href?: unknown;
  locations?: unknown;
  [key: string]: unknown;
};

const readerPreferencesAdapter = new ThMemoryPreferencesAdapter(defaultPreferences);

const readerPreferences = {
  initialPreferences: {
    ...defaultPreferences,
    settings: {
      ...defaultPreferences.settings,
      // Paginated (page-by-page) mode. This renders Thorium's "stacked" UI,
      // which keeps the header (with the table-of-contents trigger) and the
      // footer permanently visible and adds the left/right page-turn arrows.
      // Scroll mode uses the "layered" UI, which overlays and auto-hides the
      // chrome and omits the page arrows entirely.
      scroll: false,
    },
  },
  adapter: readerPreferencesAdapter,
};

const readerPreferencesFallback = {
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

const readerProgressionFallback = {
  reader: {
    progression: {
      xOfY: {
        compact: "{{ x }} of {{ y }}",
        descriptive: "{{ x }} of {{ y }} ({{ z }})",
      },
    },
  },
} as const;

const readerSharedFallback = {
  reader: {
    ...readerProgressionFallback.reader,
    tableOfContents: {
      title: "Table of contents",
      emptyState: {
        title: "No table of contents",
        description: "A table of contents was not provided by the author.",
      },
    },
  },
} as const;

const readerThoriumWebFallback = {
  reader: {
    ...readerPreferencesFallback.reader,
    ...readerProgressionFallback.reader,
  },
} as const;

const readerI18nFallbackOptions = {
  resources: {
    en: {
      "thorium-shared": readerSharedFallback,
      "thorium-web": readerThoriumWebFallback,
    },
    "en-US": {
      "thorium-shared": readerSharedFallback,
      "thorium-web": readerThoriumWebFallback,
    },
    "en-CA": {
      "thorium-shared": readerSharedFallback,
      "thorium-web": readerThoriumWebFallback,
    },
  },
} as const;

/**
 * Normalizes any reader href to the publication-relative form used by the
 * manifest's readingOrder (e.g. `OEBPS/title-page.xhtml`). The manifest proxy
 * may have served absolute hrefs in the past, so persisted positions can hold
 * stale absolute URLs that no longer match readingOrder. Mirroring the server's
 * `normalizePublicationResourcePath` keeps lookups exact.
 */
const toRelativeHref = (rawHref: string): string => {
  const hashIndex = rawHref.indexOf("#");
  const pathPart = hashIndex >= 0 ? rawHref.slice(0, hashIndex) : rawHref;
  const hash = hashIndex >= 0 ? rawHref.slice(hashIndex + 1) : "";

  let pathname = pathPart;
  if (/^https?:\/\//i.test(pathPart)) {
    try {
      pathname = new URL(pathPart).pathname;
    } catch {
      pathname = pathPart;
    }
  }

  const proxyMatch = pathname.match(/\/api\/library\/pub\/[^/]+\//);
  const pubMatch = pathname.match(/\/pub\/[^/]+\//);
  let relative = pathname;
  if (proxyMatch) {
    relative = pathname.slice(pathname.indexOf(proxyMatch[0]) + proxyMatch[0].length);
  } else if (pubMatch) {
    relative = pathname.slice(pathname.indexOf(pubMatch[0]) + pubMatch[0].length);
  }

  let decoded = relative;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    decoded = relative;
  }

  const normalized = decoded
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");

  return hash ? `${normalized}#${hash}` : normalized;
};

const sanitizeLocator = (
  locator: SerializedLocator,
  publication: ReturnType<typeof usePublication>["publication"],
): SerializedLocator | undefined => {
  if (!publication || typeof locator.href !== "string") {
    return undefined;
  }
  const relativeHref = toRelativeHref(locator.href);
  const link = publication.readingOrder?.findWithHref(relativeHref);
  if (!link) {
    return undefined;
  }
  return {
    ...locator,
    href: relativeHref,
  };
};

const ReaderContent = ({
  manifestUrl,
  storageKey,
  publicationId,
}: {
  manifestUrl: string;
  storageKey: string;
  publicationId: string | null;
}) => {
  const { publication, localDataKey, profile, isLoading, error } = usePublication({
    url: manifestUrl,
  });
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const lastQueuedPayloadRef = useRef<string>("");

  const positionLocalDataKey = `${localDataKey ?? storageKey}:position-v4`;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    let cancelled = false;
    const hydrationTarget = `${positionLocalDataKey}:${publicationId ?? "none"}`;

    const hydratePosition = async () => {
      try {
        if (publicationId) {
          const response = await fetch(
            `/api/library/progress/${encodeURIComponent(publicationId)}`,
            {
              method: "GET",
            },
          );
          if (response.ok) {
            const payload = (await response.json()) as { locator?: SerializedLocator };
            if (payload.locator) {
              const sanitized = sanitizeLocator(payload.locator, publication);
              if (sanitized) {
                window.localStorage.setItem(
                  positionLocalDataKey,
                  JSON.stringify(sanitized),
                );
              }
            }
          }
        }
      } catch {
        // Ignore transient network/storage failures and keep local fallback.
      } finally {
        if (!cancelled) {
          setHydratedKey(hydrationTarget);
        }
      }
    };

    void hydratePosition();
    return () => {
      cancelled = true;
    };
  }, [positionLocalDataKey, publication, publicationId]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null && typeof window !== "undefined") {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  // Sanitize persisted positions: normalize hrefs to publication-relative form
  // and drop any that aren't present in the current readingOrder. This prevents
  // a stale/absolute saved locator from crashing the navigator's apply() with
  // "Link for <href> not found!" when restoring the initial position. Memoized
  // so its identity is stable across renders (avoids navigator churn).
  const positionStorage = useMemo<PositionStorage>(
    () => ({
      get: () => {
        if (typeof window === "undefined" || !publication) {
          return undefined;
        }
        try {
          const raw = window.localStorage.getItem(positionLocalDataKey);
          if (!raw) {
            return undefined;
          }
          const parsed = JSON.parse(raw) as SerializedLocator;
          const sanitized = sanitizeLocator(parsed, publication);
          if (!sanitized || typeof sanitized.href !== "string") {
            return undefined;
          }
          const link = publication.readingOrder?.findWithHref(sanitized.href);
          if (!link) {
            return undefined;
          }
          const base = link.locator;
          return sanitized.locations
            ? base.copyWithLocations(sanitized.locations)
            : base;
        } catch {
          return undefined;
        }
      },
      set: (locator) => {
        if (typeof window === "undefined") {
          return;
        }
        try {
          const serialized = locator.serialize() as SerializedLocator;
          const sanitized = sanitizeLocator(serialized, publication);
          if (!sanitized) {
            return;
          }

          window.localStorage.setItem(
            positionLocalDataKey,
            JSON.stringify(sanitized),
          );

          if (!publicationId) {
            return;
          }

          const payload = JSON.stringify(sanitized);
          if (payload === lastQueuedPayloadRef.current) {
            return;
          }

          if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current);
          }
          saveTimerRef.current = window.setTimeout(() => {
            lastQueuedPayloadRef.current = payload;
            void fetch(`/api/library/progress/${encodeURIComponent(publicationId)}`, {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ locator: sanitized }),
            }).catch(() => {
              // Keep local state even if server write fails.
            });
          }, 700);
        } catch {
          // Ignore storage write failures (e.g. private mode quota).
        }
      },
    }),
    [publication, positionLocalDataKey, publicationId],
  );

  const isPositionReady =
    hydratedKey === `${positionLocalDataKey}:${publicationId ?? "none"}`;
  if (isLoading || !publication || !profile || !localDataKey || !isPositionReady) {
    return <div className="reader-status">Loading Thorium Web publication…</div>;
  }

  if (error) {
    const errorText = error.context ?? error.errorName ?? "Failed to load publication";
    return <div className="reader-status reader-status-error">{errorText}</div>;
  }

  return (
    <StatefulReaderWrapper
      profile={profile}
      publication={publication}
      localDataKey={localDataKey}
      positionStorage={positionStorage}
      preferences={readerPreferences}
      i18n={readerI18nFallbackOptions}
    />
  );
};

export default function ReaderRuntime({ manifestUrl, publicationId }: ReaderRuntimeProps) {
  const storageKey = `tls-thorium-v2:${encodeURIComponent(manifestUrl)}`;
  return (
    <ThStoreProvider storageKey={storageKey}>
      <StatefulGlobalPreferencesProvider>
        <ReaderContent
          manifestUrl={manifestUrl}
          storageKey={storageKey}
          publicationId={publicationId}
        />
      </StatefulGlobalPreferencesProvider>
    </ThStoreProvider>
  );
}
