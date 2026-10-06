export const metadata = { title: "Misthos app" };

/** Placeholder until the app shell (P0) lands. Honest empty state, no fake data. */
export default function AppPlaceholder() {
  return (
    <main style={{ minHeight: "100svh", display: "grid", placeContent: "center", gap: 16, padding: 32, textAlign: "center" }}>
      <h1 style={{ fontFamily: "var(--font-display)", textTransform: "uppercase", fontWeight: 500, margin: 0 }}>
        The Misthos app is not live yet
      </h1>
      <p className="muted" style={{ margin: 0, maxWidth: "46ch", marginInline: "auto" }}>
        Invoices, the supplier and buyer dashboards and claim links are being built. Until then this site shows only what
        exists, and nothing on it is simulated.
      </p>
      <a className="btn btn-primary" style={{ justifySelf: "center" }} href="/">
        Back to the home page
      </a>
    </main>
  );
}
