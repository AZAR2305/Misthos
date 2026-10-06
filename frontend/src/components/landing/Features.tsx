const ROWS = [
  {
    title: "Zero is a valid price",
    text: "When a buyer has idle cash, being paid early can cost the supplier nothing. The supplier's agent opens at 0% and climbs only while waiting would cost more. Very often, the answer is zero.",
  },
  {
    title: "Priced to the day, never padded",
    text: "The discount is a simple rate over the exact seconds you skip, rounded in the supplier's favour. What you see before you sign is what the contract pays.",
  },
  {
    title: "The model proposes. Code decides.",
    text: "No AI output ever reaches a signer or a contract call. Caps, a 50% rate ceiling and single-use offers are enforced on Arc, so even a fooled agent can only do what the limits allow.",
  },
];

export function Features() {
  return (
    <section id="features" className="sec">
      <p className="sec-eyebrow">Why it works</p>
      <ul className="rows">
        {ROWS.map((r) => (
          <li key={r.title} className="row">
            <h2 className="display-2">{r.title}</h2>
            <p>{r.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
