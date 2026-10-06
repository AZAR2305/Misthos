export function Features() {
  return (
    <section id="features" className="features">
      <article className="feature feature-left">
        <h2 className="display-2">
          Zero is a<br />valid price
        </h2>
        <p>
          The supplier agent starts its ask at 0% and climbs only while its cost of waiting justifies it. When the
          buyer&apos;s cash is idle, the agents clear at 0% and the supplier is simply paid early.
        </p>
      </article>
      <article className="feature feature-right">
        <h2 className="display-2">
          The model proposes.
          <br />
          Code decides.
        </h2>
        <p>
          No model output reaches a signer or a contract call. Caps, rate ceilings and single-use offers are enforced
          on Arc, so a compromised agent can only do what the limits allow.
        </p>
      </article>
    </section>
  );
}
