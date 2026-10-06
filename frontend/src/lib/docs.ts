import fs from "node:fs";
import path from "node:path";

/** The in-app docs live as markdown in content/docs and are read at build time (server only). */
export interface Doc {
  slug: string;
  title: string;
  summary: string;
  order: number;
  body: string;
}

const dir = path.join(process.cwd(), "content", "docs");

function parse(slug: string, raw: string): Doc {
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw.replace(/\r\n/g, "\n"));
  const meta: Record<string, string> = {};
  for (const line of (m?.[1] ?? "").split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { slug, title: meta.title ?? slug, summary: meta.summary ?? "", order: Number(meta.order ?? 99), body: m?.[2] ?? raw };
}

export function allDocs(): Doc[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parse(f.replace(/\.md$/, ""), fs.readFileSync(path.join(dir, f), "utf8")))
    .sort((a, b) => a.order - b.order);
}

export const getDoc = (slug: string): Doc | undefined => allDocs().find((d) => d.slug === slug);
