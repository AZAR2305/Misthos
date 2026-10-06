"use client";

import { useEffect } from "react";

/** The last line of defence: any page that throws lands here instead of a blank screen. Nothing sensitive is shown. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="fallback" role="alert">
      <p className="sec-eyebrow">Something went wrong</p>
      <h1>This page could not load</h1>
      <p className="lead">It was a problem on our side, not yours. Nothing was sent from your wallet. Try again, or come back in a minute.</p>
      {error.digest && <p className="muted tiny">Reference: {error.digest}</p>}
      <div className="fallback-actions">
        <button type="button" className="btn btn-primary" onClick={reset}>Try again</button>
        <a className="btn btn-ghost" href="/">Back to the start</a>
      </div>
    </main>
  );
}
