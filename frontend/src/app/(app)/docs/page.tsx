import type { Metadata } from "next";
import Link from "next/link";
import { DocsShell } from "@/components/app/DocsShell";
import { allDocs } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Docs",
  description: "How Misthos works for suppliers and buyers, how the agents behave, and how to run and deploy it.",
};

export default function DocsIndex() {
  return (
    <DocsShell>
      <header className="page-head">
        <h1>Docs</h1>
        <p className="lead">Short pages on how Misthos works, what is safe, and how to run it yourself.</p>
      </header>
      <ul className="docs-cards">
        {allDocs().map((d) => (
          <li key={d.slug}>
            <Link href={`/docs/${d.slug}`} className="docs-card">
              <b>{d.title}</b>
              <span className="muted">{d.summary}</span>
            </Link>
          </li>
        ))}
      </ul>
    </DocsShell>
  );
}
