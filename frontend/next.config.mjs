import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NODE_ENV === "development";

/** An origin from a configured URL, or nothing. Only addresses the owner configured may be connected to. */
const origin = (u) => {
  try {
    return u ? new URL(u).origin : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Content-Security-Policy, the documented no-nonce form (node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md): nonces would force
 * every page to render dynamically. Scripts therefore allow 'unsafe-inline', which weakens XSS protection; everything else is locked to this site and
 * to the API, RPC and agent addresses configured through NEXT_PUBLIC_*. DECISIONS.md records this trade-off.
 */
const connect = ["'self'", origin(process.env.NEXT_PUBLIC_API_URL), origin(process.env.NEXT_PUBLIC_RPC_URL ?? "https://rpc.testnet.arc.io"), origin(process.env.NEXT_PUBLIC_BUYER_AGENT_URL), origin(process.env.NEXT_PUBLIC_SUPPLIER_AGENT_URL)].filter(Boolean);
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  `connect-src ${[...new Set(connect)].join(" ")}${isDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

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
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
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
