// The public repo. VERIFY: it must be public before submission (hackathon rule). An empty string renders "unavailable".
const REPO_URL: string = "https://github.com/AZAR2305/Misthos";

// Set after deploying (contract/DEPLOYMENTS.md). Read at build time; never hard-coded. VERIFY the explorer for the network you deploy to.
const BOOK = process.env.NEXT_PUBLIC_INVOICE_BOOK_ADDRESS ?? "";
const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://explorer.testnet.arc.io";
const BOOK_OK = /^0x[0-9a-fA-F]{40}$/.test(BOOK);

export function Final() {
  return (
    <section id="final" className="final">
      <div className="final-copy" id="proof">
        <h2 className="display">
          Settles on Arc.
          <br />
          Checkable by anyone.
        </h2>
        <p className="lede">
          Numbers about Misthos come from the chain or a real run, never from a script. Industry figures name their
          source. Where a value does not exist yet, this page says so.
        </p>
        <div className="hero-actions">
          <a className="btn btn-primary" href="/app">
            Open app
          </a>
          <a className="btn btn-ghost" href="#top">
            Back to top
          </a>
        </div>
      </div>
      <dl className="proof">
        <div>
          <dt className="tag">{"{on-chain}"} InvoiceBook contract</dt>
          <dd>
            {BOOK_OK ? (
              <a className="mono" href={`${EXPLORER}/address/${BOOK}`} target="_blank" rel="noreferrer">
                {BOOK.slice(0, 6)}…{BOOK.slice(-4)}
              </a>
            ) : (
              "Unavailable: not deployed yet"
            )}
          </dd>
        </div>
        <div>
          <dt className="tag">{"{on-chain}"} USDC on Arc testnet</dt>
          <dd className="mono">0x3600…0000</dd>
        </div>
        <div>
          <dt className="tag">Repository</dt>
          <dd>
            {REPO_URL ? (
              <a href={REPO_URL} target="_blank" rel="noreferrer">
                {REPO_URL.replace("https://", "")}
              </a>
            ) : (
              "Unavailable: not published yet"
            )}
          </dd>
        </div>
      </dl>
      <footer className="foot">
        <p>Misthos Kit · MIT · Unaudited, testnet · Built for the Tameion Agents Hackathon (Canteen × Circle × Arc)</p>
      </footer>
    </section>
  );
}
