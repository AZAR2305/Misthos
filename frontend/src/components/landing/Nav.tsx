"use client";

import { useEffect, useState } from "react";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { ThemePicker } from "@/components/ThemePicker";

/** The Misthos mark: two stems (Misthos and Arc) around the zero of a 0% price. Colours come from the brand tokens in themes.css. */
export function MisthosMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 240 240" aria-hidden="true" fill="none">
      <rect width="240" height="240" rx="52" fill="var(--brand-tile)" />
      <path d="M60 170L100 70H118L88 170H60Z" fill="var(--brand-stem)" />
      <path d="M180 170L140 70H122L152 170H180Z" fill="var(--brand-stem)" />
      <ellipse cx="120" cy="125" rx="12" ry="24" stroke="var(--brand-zero)" strokeWidth="8" />
    </svg>
  );
}

/** Wordmark left, the mark in the middle, the way in on the right. Nothing else. */
export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header className="nav" data-scrolled={scrolled}>
      <a href="#top" className="nav-brand" aria-label="Misthos home">
        Misthos<sup>®</sup>
      </a>
      <a href="#top" className="nav-mark" aria-label="Back to top">
        <MisthosMark size={28} />
      </a>
      <div className="nav-end">
        <ThemePicker />
        <ConnectButton compact />
        <a href="/app" className="nav-cta">
          Open app
        </a>
      </div>
    </header>
  );
}
