const STEPS = [
  { word: "Sign", text: "The supplier signs the invoice with a wallet. No gas and no browser extension." },
  { word: "Register", text: "InvoiceBook on Arc records the signed invoice once. Duplicates are rejected." },
  { word: "Approve", text: "The buyer accepts the work. Only approved invoices can be paid early." },
  {
    word: "Offer",
    text: "The supplier agent posts a short ladder of signed offers, starting at 0%. The buyer agent accepts the first rung at or above its private hurdle.",
  },
  {
    word: "Pay early",
    text: "The contract pays the supplier in USDC and closes the invoice exactly once. A small success fee on the discount is paid by the buyer, never by the supplier.",
  },
];

export function Steps() {
  return (
    <section id="steps" className="sec">
      <p className="sec-eyebrow">How it works</p>
      <ol className="rows steps-list">
        {STEPS.map((s, i) => (
          <li key={s.word} className="row">
            <p className="step-n mono">{String(i + 1).padStart(2, "0")}</p>
            <h3 className="display-2">{s.word}</h3>
            <p>{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
