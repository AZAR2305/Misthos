import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DocsShell } from "@/components/app/DocsShell";
import { CodeBlock } from "@/components/ui/kit";
import { allDocs, getDoc } from "@/lib/docs";

export const dynamicParams = false;

export function generateStaticParams() {
  return allDocs().map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const doc = getDoc((await params).slug);
  return doc ? { title: doc.title, description: doc.summary } : {};
}

const text = (n: ReactNode): string => (typeof n === "string" ? n : Array.isArray(n) ? n.map(text).join("") : "");

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) notFound();
  const all = allDocs();
  const i = all.findIndex((d) => d.slug === slug);
  const prev = all[i - 1];
  const next = all[i + 1];
  return (
    <DocsShell>
    <article className="prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href = "", children }) =>
            href.startsWith("/") ? (
              <Link href={href}>{children}</Link>
            ) : (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ),
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const body = text(children);
            return className?.startsWith("language-") || body.includes("\n") ? <CodeBlock>{body.replace(/\n$/, "")}</CodeBlock> : <code className="inline-code">{body}</code>;
          },
          table: ({ children }) => (
            <div className="table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {doc.body}
      </ReactMarkdown>
      <nav className="doc-pager" aria-label="More docs">
        {prev ? <Link href={`/docs/${prev.slug}`}>← {prev.title}</Link> : <span />}
        {next ? <Link href={`/docs/${next.slug}`}>{next.title} →</Link> : <span />}
      </nav>
    </article>
    </DocsShell>
  );
}
