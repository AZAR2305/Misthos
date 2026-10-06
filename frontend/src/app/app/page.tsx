export const metadata = { title: "Misthos app" };

/** Placeholder until the app shell (P0) lands. Honest empty state, no fake data. */
export default function AppPlaceholder() {
  return (
    <main style={{ minHeight: "100svh", display: "grid", placeContent: "center", gap: 16, padding: 32, textAlign: "center" }}>
      <h1 style={{ fontFamily: "var(--font-display)", textTransform: "uppercase", fontWeight: 500, margin: 0 }}>
        The app is the next build step
      </h1>
      <p className="muted" style={{ margin: 0 }}>
        The shell, wallets and invoice pages are not built yet. Nothing here is mocked.
      </p>
      <a className="btn btn-primary" style={{ justifySelf: "center" }} href="/">
        Back to the landing page
      </a>
    </main>
  );
}
