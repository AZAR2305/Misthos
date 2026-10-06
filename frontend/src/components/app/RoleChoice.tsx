"use client";

import { useRouter } from "next/navigation";
import type { PointerEvent } from "react";
import type { Role } from "@/lib/storage";
import { Crystals } from "./Gate";

export const ROLE_HOME: Record<Role, string> = { supplier: "/supplier", buyer: "/buyer" };

const ROLES: Array<{ role: Role; tag: string; title: string; sub: string; bullets: string[]; cta: string }> = [
  {
    role: "supplier",
    tag: "{supplier}",
    title: "I am owed money",
    sub: "You send invoices and want to be paid sooner.",
    bullets: ["Create an invoice and sign it once.", "Offer early payment from 0%, and see the price in dollars first.", "Get paid in USDC the moment the buyer accepts."],
    cta: "Continue as supplier",
  },
  {
    role: "buyer",
    tag: "{buyer}",
    title: "I owe money",
    sub: "You approve invoices and have cash to spare.",
    bullets: ["Approve invoices when the work is done.", "Pay early with spare cash and keep the discount.", "Set caps so nothing can move more than you allow."],
    cta: "Continue as buyer",
  },
];

/** Cards tilt towards the pointer and light up under it. Plain CSS variables, no layout work per move. */
function tilt(e: PointerEvent<HTMLElement>) {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  el.style.setProperty("--rx", `${((0.5 - y) * 7).toFixed(2)}deg`);
  el.style.setProperty("--ry", `${((x - 0.5) * 9).toFixed(2)}deg`);
  el.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
  el.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
}
function untilt(e: PointerEvent<HTMLElement>) {
  e.currentTarget.style.removeProperty("--rx");
  e.currentTarget.style.removeProperty("--ry");
}

function Art({ role }: { role: Role }) {
  return role === "supplier" ? (
    <svg viewBox="0 0 120 120" aria-hidden="true" className="role-art">
      <rect x="26" y="14" width="68" height="92" rx="9" className="art-fill" />
      <rect x="38" y="30" width="30" height="6" rx="3" className="art-line" />
      <rect x="38" y="44" width="44" height="4" rx="2" className="art-dim" />
      <rect x="38" y="54" width="38" height="4" rx="2" className="art-dim" />
      <rect x="38" y="64" width="44" height="4" rx="2" className="art-dim" />
      <circle cx="82" cy="88" r="14" className="art-coin" />
      <path d="M76 88l5 5 9-10" className="art-tick" />
    </svg>
  ) : (
    <svg viewBox="0 0 120 120" aria-hidden="true" className="role-art">
      <ellipse cx="60" cy="94" rx="36" ry="10" className="art-fill" />
      <ellipse cx="60" cy="80" rx="36" ry="10" className="art-coin" />
      <ellipse cx="60" cy="64" rx="36" ry="10" className="art-fill" />
      <ellipse cx="60" cy="50" rx="36" ry="10" className="art-coin" />
      <ellipse cx="60" cy="34" rx="36" ry="10" className="art-fill" />
      <path d="M60 24v20M54 29h9a4 4 0 010 8h-7a4 4 0 000 8h10" className="art-line" fill="none" />
    </svg>
  );
}

/** Shown right after a wallet connects, until a side is chosen. The choice is remembered per wallet and is never binding. */
export function RoleChoice({ address, onChoose }: { address: string; onChoose(role: Role): void }) {
  const router = useRouter();
  return (
    <section className="gate role-stage" aria-labelledby="role-title">
      <Crystals />
      <div className="gate-inner role-inner">
        <p className="eyebrow">{`Connected ${address.slice(0, 6)}…${address.slice(-4)}`}</p>
        <h1 id="role-title" className="gate-title">
          How will you use Misthos?
        </h1>
        <p className="lead gate-lead">Pick the side that fits today. You can switch from the top bar whenever you like; the same wallet can be both.</p>
        <div className="role-cards">
          {ROLES.map((r, i) => (
            <button
              key={r.role}
              type="button"
              className="role-card"
              data-role={r.role}
              style={{ ["--d" as string]: `${120 + i * 110}ms` }}
              onPointerMove={tilt}
              onPointerLeave={untilt}
              onClick={() => {
                onChoose(r.role);
                router.push(ROLE_HOME[r.role]);
              }}
            >
              <span className="role-glow" aria-hidden="true" />
              <Art role={r.role} />
              <span className="ptag">{r.tag}</span>
              <span className="role-title">{r.title}</span>
              <span className="muted">{r.sub}</span>
              <ul>
                {r.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <span className="role-go">{r.cta} →</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
