/**
 * The public address of this site, from the environment only. Nothing falls back to a local address: with no value set, the
 * pages that need an absolute URL (sitemap, share image links) simply leave it out.
 */
export const SITE_URL: string | undefined =
  (process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "")).replace(/\/$/, "") || undefined;
