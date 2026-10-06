"use client";

import { useEffect, useRef, useState } from "react";
import { THEMES, THEME_IDS, setTheme, useThemeId, type ThemeId } from "@/lib/themes";

/** Small swatch of a theme's three key colours. */
const SWATCH: Record<ThemeId, [string, string, string]> = {
  mint: ["#fafaf9", "#82de91", "#1c1917"],
  "mint-dark": ["#100f0e", "#82de91", "#fafaf9"],
};

/** Switches the whole site (page, 3D scene and agents) between colour themes and remembers the choice. */
export function ThemePicker() {
  const id = useThemeId();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", on);
    return () => window.removeEventListener("mousedown", on);
  }, [open]);
  const sw = SWATCH[id];
  return (
    <div className="theme-picker" ref={box}>
      <button type="button" className="theme-btn" aria-expanded={open} aria-label="Change colour theme" onClick={() => setOpen((v) => !v)}>
        <span className="swatch" aria-hidden="true">
          {sw.map((c) => <i key={c} style={{ background: c }} />)}
        </span>
        <span className="theme-name">Theme</span>
      </button>
      {open && (
        <div className="theme-menu" role="menu">
          {THEME_IDS.map((t) => (
            <button key={t} type="button" role="menuitemradio" aria-checked={t === id} className="theme-option" onClick={() => { setTheme(t); setOpen(false); }}>
              <span className="swatch" aria-hidden="true">{SWATCH[t].map((c) => <i key={c} style={{ background: c }} />)}</span>
              <span>
                <b>{THEMES[t].label}</b>
                <small>{THEMES[t].blurb}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
