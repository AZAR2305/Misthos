import Link from "next/link";

export default function NotFound() {
  return (
    <main className="fallback">
      <p className="sec-eyebrow">404</p>
      <h1>That page does not exist</h1>
      <p className="lead">The link may be old, or mistyped. Everything public is one click away.</p>
      <div className="fallback-actions">
        <Link className="btn btn-primary" href="/">Back to the start</Link>
        <Link className="btn btn-ghost" href="/invoices">All invoices</Link>
        <Link className="btn btn-ghost" href="/stats">Live stats</Link>
      </div>
    </main>
  );
}
