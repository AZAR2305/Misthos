import Link from "next/link";
import type { ReactNode } from "react";
import { allDocs } from "@/lib/docs";

/** The docs sidebar and column. Docs live inside the app, with the same header, so nobody has to go to the repository to read how it works. */
export function DocsShell({ children }: { children: ReactNode }) {
  const docs = allDocs();
  return (
    <div className="docs">
      <nav className="docs-nav" aria-label="Documentation">
        <p className="sec-eyebrow">Docs</p>
        <ul>
          {docs.map((d) => (
            <li key={d.slug}>
              <Link href={`/docs/${d.slug}`}>{d.title}</Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="docs-main">{children}</div>
    </div>
  );
}
