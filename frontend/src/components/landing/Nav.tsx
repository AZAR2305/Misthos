"use client";

import { useEffect, useRef, useState } from "react";
import { onTick } from "./scene-store";

export function ArcGlyph({ size = 22 }: { size?: number }) {
  // Placeholder arch mark. Replace with the official Arc vector once it is verified (docs/DECISIONS.md).
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path d="M3 20V12a9 9 0 0 1 18 0v8h-5v-8a4 4 0 0 0-8 0v8H3Z" fill="currentColor" />
    </svg>
  );
}

const LINKS = [
  { href: "#why", label: "Why now" },
  { href: "#steps", label: "How it works" },
  { href: "#agents", label: "The agents" },
  { href: "#proof", label: "Proof" },
];

export function Nav() {
  const [open, setOpen] = useState(false);
  const header = useRef<HTMLElement>(null);

  useEffect(() => {
    let last: boolean | null = null;
    return onTick(({ scrollY }) => {
      const scrolled = scrollY > 40;
      if (scrolled !== last && header.current) {
        last = scrolled;
        header.current.dataset.scrolled = String(scrolled);
      }
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header ref={header} className="nav" data-scrolled="false">
      <a href="#top" className="nav-brand" aria-label="Misthos home">
        <ArcGlyph />
        <span>MISTHOS</span>
      </a>
      <button
        type="button"
        className="nav-burger"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="site-menu"
        onClick={() => setOpen((v) => !v)}
      >
        <span />
        <span />
      </button>
      <a href="/app" className="nav-cta">
        Open app
      </a>
      <nav id="site-menu" className="nav-menu" data-open={open} aria-hidden={!open}>
        <ul>
          {LINKS.map((l, i) => (
            <li key={l.href}>
              <a href={l.href} tabIndex={open ? 0 : -1} onClick={() => setOpen(false)}>
                <span className="mono">//{String(i + 1).padStart(2, "0")}</span>
                {l.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
