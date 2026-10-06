// WCAG 2.x contrast ratios for the colour pairs the UI actually uses, per theme, read from design/themes.css.
//   node scripts/contrast.mjs        exits 1 if any text pair is below 4.5:1 (large/UI pairs below 3:1)
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync(path.resolve(import.meta.dirname, "..", "design", "themes.css"), "utf8");
const themes = {};
for (const m of css.matchAll(/(?:\[data-theme="([a-z-]+)"\])\s*\{([\s\S]*?)\n\}/g)) {
  const vars = {};
  for (const v of m[2].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) vars[v[1]] = v[2];
  themes[m[1]] = vars;
}
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const lum = (h) => { const n = parseInt(h.slice(1), 16); return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [label, foreground var, background var, minimum]
const PAIRS = [
  ["body text on page", "color-text", "landing-bg", 4.5],
  ["muted text on page", "color-text-muted", "landing-bg", 4.5],
  ["body text on card", "color-text", "color-surface-1", 4.5],
  ["muted text on card", "color-text-muted", "color-surface-1", 4.5],
  ["link / accent on page", "accent", "landing-bg", 4.5],
  ["link / accent on card", "accent", "color-surface-1", 4.5],
  ["accent text on tint", "accent-strong", "tint", 4.5],
  ["primary button text", "color-on-primary", "color-primary", 4.5],
  ["money number on card", "color-money", "color-surface-1", 4.5],
  ["agent text on agent note", "color-agent-text", "color-agent-bg", 4.5],
  ["agent tag on agent note", "agent-soft", "color-agent-bg", 4.5],
  ["status ok on card", "color-ok", "color-surface-1", 4.5],
  ["status bad on card", "color-bad", "color-surface-1", 4.5],
  ["focus ring on page (UI, 3:1)", "color-focus", "landing-bg", 3],
  ["border on page (UI, 1.4:1)", "color-border-strong", "landing-bg", 1.4],
];
let bad = 0;
for (const [id, v] of Object.entries(themes)) {
  console.log(`\n${id}`);
  for (const [label, fg, bg, min] of PAIRS) {
    if (!v[fg] || !v[bg]) { console.log(`  ?    ${label}: missing ${fg} or ${bg}`); bad++; continue; }
    const r = ratio(v[fg], v[bg]);
    const ok = r >= min;
    if (!ok) bad++;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${r.toFixed(2).padStart(5)}:1  ${label}`);
  }
}
console.log(bad ? `\n${bad} pair(s) below target` : "\nall pairs meet their target");
process.exitCode = bad ? 1 : 0;
