import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The local end-to-end run builds into its own folder so it never clobbers a dev or production build.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Trace from the repo root so the pnpm workspace lockfile is found.
  outputFileTracingRoot: path.join(here, ".."),
  turbopack: { root: path.join(here, "..") },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
      // The character model never changes under the same name: let browsers and the CDN keep it.
      { source: "/models/:file*", headers: [{ key: "Cache-Control", value: "public, max-age=604800, stale-while-revalidate=86400" }] },
    ];
  },
};

export default nextConfig;
