import type { NextConfig } from "next";

// Additional origins allowed to reach the dev server (HMR / dev assets) when it
// is bound to 0.0.0.0 for LAN testing. Set ALLOWED_DEV_ORIGINS to a comma-
// separated list of hosts, e.g. ALLOWED_DEV_ORIGINS=192.168.10.200,my-host.local
const allowedDevOrigins = process.env.ALLOWED_DEV_ORIGINS
  ?.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  output: "standalone",
  images: { unoptimized: true },
  // The Thorium reader (@edrlab/thorium-web / @readium navigator) keeps its
  // EPUB navigator in a module-level singleton and tears it down in an async
  // callback. React StrictMode's dev-only mount→unmount→remount double-invoke
  // races that teardown against the remount, nulling the live navigator. The
  // result is a reader with no page content and dead nav/TOC controls (every
  // navigator command no-ops). Disabling StrictMode makes dev mirror the
  // single-mount behaviour of a production build, which the reader requires.
  reactStrictMode: false,
  ...(allowedDevOrigins && allowedDevOrigins.length > 0
    ? { allowedDevOrigins }
    : {}),
};

export default nextConfig;
