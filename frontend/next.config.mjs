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
};

export default nextConfig;
