export function Who() {
  return (
    <section id="who" className="who">
      <h2 className="display-2 who-title">Built for both sides of an invoice</h2>
      <div className="who-grid">
        <article className="who-card">
          <p className="tag">Supplier</p>
          <h3>Get paid days after approval</h3>
          <ul>
            <li>Sign once with your wallet. The invoice is on Arc, and nobody can alter it.</li>
            <li>Your agent offers early payment from 0% and never below what waiting costs you.</li>
            <li>You see the price in dollars before anything is sent, and you can pause it at any time.</li>
          </ul>
          <a className="btn btn-primary" href="/supplier">
            Open supplier dashboard
          </a>
        </article>
        <article className="who-card">
          <p className="tag">Buyer</p>
          <h3>Earn on bills you already owe</h3>
          <ul>
            <li>Idle USDC captures a discount on approved invoices. It is your own cash, with no outside funding.</li>
            <li>The allocator picks the best set within your cash floor and upcoming payroll, and explains its choice.</li>
            <li>Your hurdle rate stays private, and big payments wait for your sign-off.</li>
          </ul>
          <a className="btn btn-primary" href="/buyer">
            Open buyer dashboard
          </a>
        </article>
      </div>
    </section>
  );
}
