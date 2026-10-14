import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/** Public pages only. Pages that act for a person (supplier, buyer, claim links) are left out. */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!SITE_URL) return []; // a sitemap needs absolute addresses; without a configured site there is none to give
  const pages = ["", "/app", "/invoices", "/ledger", "/stats", "/agents", "/shadow"];
  return pages.map((p) => ({ url: `${SITE_URL}${p}`, changeFrequency: p === "" ? "weekly" : "daily" }));
}
