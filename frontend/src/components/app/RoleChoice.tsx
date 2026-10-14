"use client";

import { useRouter } from "next/navigation";
import { useState, type PointerEvent } from "react";
import type { Role } from "@/lib/storage";
import { CONFIG } from "@/lib/config";
import { ROLE_REGISTRY_ABI, ROLE_VALUE } from "@/lib/chain/roles";
import { appChain } from "@/lib/chain/client";
import { useTx } from "@/lib/tx";
import { Crystals } from "./Gate";

export const ROLE_HOME: Record<Role, string> = { supplier: "/supplier", buyer: "/buyer" };

const ROLES: Array<{ role: Role; tag: string; title: string; sub: string; bullets: string[]; cta: string }> = [
  {
    role: "supplier",
    tag: "Supplier",
    title: "I am owed money",
    sub: "You send invoices and want to be paid sooner.",
    bullets: ["Create an invoice and sign it once.", "Offer early payment from 0%, and see the price in dollars first.", "Get paid in USDC the moment the buyer accepts."],
    cta: "Continue as supplier",
  },
  {
    role: "buyer",
    tag: "Buyer",
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
export function RoleChoice({ address, onChoose }: { address: string; onChoose(role: Role): void | null | string | Promise<void | null | string> }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Role | null>(null);
  const [understood, setUnderstood] = useState(false);
  const tx = useTx();
  const fixed = !!CONFIG.roleRegistry;

  /** Record the role on Arc, then carry on. The chain is the only place a role is ever made. */
  const register = async (role: Role) => {
    const hash = await tx.run({ pending: "Registering your role on Arc", done: "Role registered" }, (wc, account) =>
      wc.writeContract({ address: CONFIG.roleRegistry!, abi: ROLE_REGISTRY_ABI, functionName: "choose", args: [ROLE_VALUE[role]], account, chain: appChain }),
    );
    if (!hash) return setError("The role was not registered, so nothing changed. Nothing is recorded until the transaction succeeds.");
    window.dispatchEvent(new Event("misthos:role"));
    const refused = await onChoose(role);
    if (typeof refused === "string") return setError(refused);
    router.push(ROLE_HOME[role]);
  };

  return (
    <section className="gate role-stage" aria-labelledby="role-title">
      <Crystals />
      <div className="gate-inner role-inner">
        <p className="eyebrow">{`Connected ${address.slice(0, 6)}…${address.slice(-4)}`}</p>
        <h1 id="role-title" className="gate-title">
          How will you use Misthos?
        </h1>
        <p className="lead gate-lead">
          {fixed
            ? "Your wallet is either a supplier or a buyer, and you choose once. It is recorded on Arc by a contract and nobody, including us, can change it later."
            : "Pick the side that fits today. You can switch from the top bar whenever you like; the same wallet can be both."}
        </p>
        {error && <p className="field-error" role="alert">{error}</p>}
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
              data-selected={pending === r.role}
              onClick={async () => {
                if (fixed) return setPending(r.role); // a permanent choice is confirmed first
                const refused = await onChoose(r.role);
                if (typeof refused === "string") return setError(refused);
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
        {fixed && pending && (
          <div className="card role-confirm" role="group" aria-label="Confirm your role">
            <h2>Register this wallet as a {pending}?</h2>
            <p>
              This is recorded on Arc and <b>can never be changed</b>. This wallet will only ever be a {pending}: it cannot act as a {pending === "supplier" ? "buyer" : "supplier"}, now or later, on this site or anywhere that checks the registry.
              If you need the other side, use a different wallet. Registering costs a few cents of USDC for the network fee.
            </p>
            <label className="check" style={{ display: "flex", gap: 8, margin: "10px 0" }}>
              <input id="role-understood" type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
              <span>I understand this is permanent.</span>
            </label>
            <div className="actions-row">
              <button type="button" className="btn btn-primary" disabled={!understood} onClick={() => void register(pending)}>Register as {pending} on Arc</button>
              <button type="button" className="btn btn-ghost" onClick={() => { setPending(null); setUnderstood(false); }}>Not yet</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
