"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import brandingConfig from "@/config/thorium-web/branding.local.json";
import ReaderErrorBoundary from "./reader-error-boundary";

const ReaderRuntime = dynamic(() => import("./reader-runtime"), {
  ssr: false,
  loading: () => <div className="reader-status">Loading Thorium Web runtime…</div>,
});

type CatalogItem = {
  title: string;
  identifier: string | null;
  assetId: string | null;
  publicationId: string | null;
  coverUrl: string | null;
  author: string | null;
  manifestUrl: string | null;
};

type SessionResponse = {
  books: CatalogItem[];
  error?: string;
};

const normalizeLoadError = (message: string): string => {
  const lower = message.toLowerCase();
  if (lower.includes("invalid credentials") || lower.includes("login failed")) {
    return "Invalid email or password.";
  }
  if (lower.includes("no active session")) {
    return "Your session has expired. Please sign in again.";
  }
  if (
    lower.includes("fetch failed") ||
    lower.includes("catalog request failed") ||
    lower.includes("catalog publications request failed") ||
    lower.includes("entitlements request failed") ||
    lower.includes("unable to reach the library service") ||
    lower.includes("library service returned an invalid response")
  ) {
    return "Unable to sign in right now. Please try again.";
  }
  if (message.length > 180) {
    return "Unable to sign in right now. Please try again.";
  }
  return message;
};

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [currentBook, setCurrentBook] = useState<CatalogItem | null>(null);
  const [catalogView, setCatalogView] = useState<"grid" | "list">("grid");
  const [libraryViewRevision, setLibraryViewRevision] = useState(0);
  const isReading = Boolean(currentBook?.manifestUrl);

  const themeVars: CSSProperties & Record<string, string> = {
    "--tls-page-background": brandingConfig.theme.colors.background,
    "--tls-surface": brandingConfig.theme.colors.surface,
    "--tls-surface-alt": brandingConfig.theme.colors.surfaceAlt,
    "--tls-border": brandingConfig.theme.colors.border,
    "--tls-text": brandingConfig.theme.colors.textPrimary,
    "--tls-text-secondary": brandingConfig.theme.colors.textSecondary,
    "--tls-accent": brandingConfig.theme.colors.accent,
    "--tls-accent-text": brandingConfig.theme.colors.accentText,
    "--th-theme-background": isReading ? "#000000" : brandingConfig.theme.colors.background,
  };

  const visibleCatalog = useMemo(
    () => catalog.filter((item) => !!item.manifestUrl),
    [catalog],
  );

  const openBook = (book: CatalogItem) => {
    if (!book.manifestUrl) {
      return;
    }
    setCurrentBook(book);
  };

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (window.location.search.includes("manifest=")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const root = document.documentElement;
    root.style.setProperty(
      "--th-theme-background",
      isReading ? "#000000" : brandingConfig.theme.colors.background,
    );
    document.body.classList.toggle("tls-reader-active", isReading);
    return () => {
      root.style.removeProperty("--th-theme-background");
      document.body.classList.remove("tls-reader-active");
    };
  }, [isReading]);

  useEffect(() => {
    const restoreSession = async () => {
      setIsBusy(true);
      try {
        const response = await fetch("/api/library/session", { method: "GET" });
        const payload = (await response.json()) as SessionResponse;
        if (!response.ok) {
          setIsAuthenticated(false);
          setCatalog([]);
          return;
        }
        setCatalog(payload.books ?? []);
        setIsAuthenticated(true);
      } catch {
        setIsAuthenticated(false);
        setCatalog([]);
      } finally {
        setIsBusy(false);
      }
    };
    restoreSession();
  }, []);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const credentials = new FormData(event.currentTarget);
    setIsBusy(true);
    setLoadError(null);
    setCurrentBook(null);
    try {
      const response = await fetch("/api/library/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: credentials.get("username"),
          password: credentials.get("password"),
        }),
      });
      const payload = (await response.json()) as SessionResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to sign in and load your library.");
      }
      setCatalog(payload.books ?? []);
      setIsAuthenticated(true);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to sign in and load your library.";
      setLoadError(normalizeLoadError(message));
      setIsAuthenticated(false);
    } finally {
      setIsBusy(false);
    }
  };

  const handleSignOut = async () => {
    await fetch("/api/library/session", { method: "DELETE" });
    setIsAuthenticated(false);
    setCatalog([]);
    setCurrentBook(null);
    setLoadError(null);
  };

  const handleBackToLibrary = () => {
    setCurrentBook(null);
    setLibraryViewRevision((current) => current + 1);
  };

  return (
    <main className={`thorium-app${isReading ? " thorium-app-reading" : ""}`} style={themeVars}>
      {!isReading ? (
        <header className="thorium-toolbar" key={`header-${libraryViewRevision}`}>
          <div className="thorium-brand">
            <Image
              src={brandingConfig.assets.logo.src}
              alt={brandingConfig.assets.logo.alt}
              width={brandingConfig.assets.logo.width ?? 52}
              height={brandingConfig.assets.logo.height ?? 49}
              priority
            />
            <strong>{brandingConfig.brand.name}</strong>
          </div>
          <div className="toolbar-actions">
            {isAuthenticated ? (
              <button type="button" className="tls-secondary-btn" onClick={handleSignOut}>
                Sign out
              </button>
            ) : null}
          </div>
        </header>
      ) : null}

      {loadError ? <div className="reader-inline-error">{loadError}</div> : null}

      {!isAuthenticated ? (
        <section className="auth-shell">
          <form className="auth-form" onSubmit={handleLogin}>
            <h2>Sign in to your library</h2>
            <label>
              Email
              <input
                id="login-username"
                name="username"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
            </label>
            <label>
              Password
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <button type="submit" disabled={isBusy}>
              {isBusy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </section>
      ) : currentBook?.manifestUrl ? (
        <section className="thorium-runtime">
          <div className="reader-overlay-controls">
            <button
              type="button"
              className="tls-reader-back-btn"
              onClick={handleBackToLibrary}
            >
              Back to library
            </button>
          </div>
          <ReaderErrorBoundary>
            <div className="thorium-runtime-frame">
              <ReaderRuntime
                manifestUrl={currentBook.manifestUrl}
                publicationId={currentBook.publicationId}
              />
            </div>
          </ReaderErrorBoundary>
        </section>
      ) : (
        <section className="catalog-list" key={`catalog-${libraryViewRevision}`}>
          <div className="catalog-header">
            <h2>Your books</h2>
            <div className="catalog-view-toggle">
              <button
                type="button"
                className={catalogView === "grid" ? "is-active" : ""}
                onClick={() => setCatalogView("grid")}
              >
                Grid
              </button>
              <button
                type="button"
                className={catalogView === "list" ? "is-active" : ""}
                onClick={() => setCatalogView("list")}
              >
                List
              </button>
            </div>
          </div>
          {!visibleCatalog.length ? (
            <p className="empty-library">No entitled books were returned for this account.</p>
          ) : (
            <ul className={catalogView === "grid" ? "catalog-grid" : "catalog-row-list"}>
              {visibleCatalog.map((item) => (
                <li key={`${item.title}-${item.manifestUrl ?? "none"}`}>
                  <div className="book-cover-wrapper">
                    {item.coverUrl ? (
                      <img src={item.coverUrl} alt="" className="book-cover" />
                    ) : (
                      <div className="book-cover book-cover-placeholder">No cover</div>
                    )}
                  </div>
                  <div className="book-meta">
                    <span className="book-title">{item.title}</span>
                    {item.author ? <span className="book-author">{item.author}</span> : null}
                    <button type="button" onClick={() => openBook(item)}>
                      Read
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
