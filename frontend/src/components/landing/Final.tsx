const REPO_URL: string = ""; // VERIFY: set once the public GitHub repo exists. An empty value renders "unavailable".

export function Final() {
  return (
    <section id="final" className="final">
      <div className="final-copy" id="proof">
        <h2 className="display">
          Settled on Arc.
          <br />
          Checkable by anyone.
        </h2>
        <p className="lede">
          Every number on this site comes from the chain, the database or a real model call. Where a value does not
          exist yet, it says so.
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
          <dd>Unavailable: not deployed yet</dd>
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
