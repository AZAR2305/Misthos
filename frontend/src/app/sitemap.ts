import type { MetadataRoute } from "next";
import { allDocs } from "@/lib/docs";

/** Public pages only. Pages that act for a person (supplier, buyer, claim links) are left out. */
export default function sitemap(): MetadataRoute.Sitemap {
  const site = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const pages = ["", "/app", "/invoices", "/ledger", "/stats", "/agents", "/kit", "/docs", ...allDocs().map((d) => `/docs/${d.slug}`)];
  return pages.map((p) => ({ url: `${site}${p}`, changeFrequency: p === "" ? "weekly" : "daily" }));
}
