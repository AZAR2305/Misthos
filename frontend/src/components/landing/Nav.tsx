"use client";

import { useEffect, useState } from "react";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { ThemePicker } from "@/components/ThemePicker";

export function ArcGlyph({ size = 22 }: { size?: number }) {
  // Placeholder arch mark. Replace with the official Arc vector once it is verified (docs/DECISIONS.md).
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path d="M3 20V12a9 9 0 0 1 18 0v8h-5v-8a4 4 0 0 0-8 0v8H3Z" fill="currentColor" />
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
        <ArcGlyph size={26} />
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
