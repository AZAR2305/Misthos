"use client";

import { useEffect, useRef, useState } from "react";
import { onTick } from "./scene-store";

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
    text: "The contract pays the supplier in USDC and closes the invoice once. Both agents then write ERC-8004 feedback.",
  },
];

export function Steps() {
  const section = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const slides = useRef<Array<HTMLDivElement | null>>([]);
  const bar = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let last = -1;
    return onTick(({ scrollY, vh }) => {
      const s = section.current;
      const t = track.current;
      if (!s || !t) return;
      const len = s.offsetHeight - vh;
      const prog = Math.min(1, Math.max(0, (scrollY - s.offsetTop) / len));
      const f = prog * (STEPS.length - 1);
      const slideW = slides.current[0]?.offsetWidth ?? 0;
      t.style.transform = `translate3d(${window.innerWidth / 2 - slideW / 2 - f * slideW}px,0,0)`;
      slides.current.forEach((el, i) => {
        if (el) el.style.opacity = String(0.28 + 0.72 * Math.max(0, 1 - Math.abs(i - f) * 0.9));
      });
      if (bar.current) bar.current.style.transform = `scaleX(${(f + 1) / STEPS.length})`;
      const idx = Math.round(f);
      if (idx !== last) {
        last = idx;
        setActive(idx);
      }
    });
  }, []);

  return (
    <section id="steps" ref={section} className="steps" style={{ height: `${(STEPS.length + 1) * 100}vh` }}>
      <div className="steps-pin">
        <div className="steps-count" aria-live="polite">
          <p className="mono">
            {active + 1} / {STEPS.length}
          </p>
          <span className="steps-bar">
            <span ref={bar} />
          </span>
        </div>
        <div ref={track} className="steps-track">
          {STEPS.map((s, i) => (
            <div
              key={s.word}
              ref={(el) => {
                slides.current[i] = el;
              }}
              className="step"
              aria-current={i === active ? "step" : undefined}
            >
              <p className="mono step-n">//{String(i + 1).padStart(2, "0")}</p>
              <h3 className="display-3">{s.word}</h3>
              <p className="step-text">{s.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
