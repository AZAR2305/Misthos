"use client";

import { useSyncExternalStore } from "react";

/**
 * Colour themes. CSS colours live in design/themes.css (selected by data-theme on <html>); this file holds the matching
 * palette for the three.js agents, which cannot read CSS variables per frame. Keep the two in step.
 *
 * Both themes come from the Lovable "Team Directory" template (mint on stone). The supplier agent is mint; the buyer
 * agent is violet, the colour the UI keeps for "an agent said or decided this".
 */
export type ThemeId = "arc" | "arc-dark" | "arc-midnight" | "mint" | "mint-dark";

export interface SceneTheme {
  /** Page background the canvas sits on. */
  bg: string;
  dark: boolean;
  /** Negotiation-channel arc and its travelling packet. */
  curve: string;
  dot: string;
  /** Light cards reflected in the glossy surfaces. */
  env: { key: string; side: string; floor: string };
  robot: {
    supplier: string;
    buyer: string;
    /** Shell colour of each agent body: the supplier agent is green, the buyer agent pink-violet. */
    shellSupplier: string;
    shellBuyer: string;
    supplierGlow: string;
    buyerGlow: string;
    eyes: string;
    eyesIntensity: number;
    joints: string;
    platform: string;
    platformEmissive: string;
    metalness: number;
    roughness: number;
    keyLight: string;
    rimLight: string;
    ambient: string;
  };
}

export interface ThemeInfo {
  id: ThemeId;
  label: string;
  blurb: string;
  scene: SceneTheme;
}

export const THEMES: Record<ThemeId, ThemeInfo> = {
  arc: {
    id: "arc",
    label: "Arc",
    blurb: "Arc's palette in light: pale Sail blue surfaces, Cello navy text.",
    scene: {
      bg: "#f4f9fe",
      dark: false,
      curve: "#1f6fb0",
      dot: "#a7d9fa",
      env: { key: "#ffffff", side: "#a7d9fa", floor: "#ffffff" },
      robot: { supplier: "#3fbf8a", buyer: "#b565c9", shellSupplier: "#d9f5e6", shellBuyer: "#f3dffa", supplierGlow: "#3fbf8a", buyerGlow: "#c77ddb", eyes: "#3fbf8a", eyesIntensity: 0.2, joints: "#1b3158", platform: "#eaf3fb", platformEmissive: "#d6e5f3", metalness: 0.3, roughness: 0.32, keyLight: "#ffffff", rimLight: "#a7d9fa", ambient: "#ffffff" },
    },
  },
  "arc-dark": {
    id: "arc-dark",
    label: "Arc dark",
    blurb: "The spec palette: Cello navy surfaces, Sail blue for money, Bossanova for agents.",
    scene: {
      bg: "#0f1d36",
      dark: true,
      curve: "#a7d9fa",
      dot: "#e4f3fd",
      env: { key: "#e4f3fd", side: "#a7d9fa", floor: "#cbe8fb" },
      robot: { supplier: "#6fe0a5", buyer: "#d89af0", shellSupplier: "#a6efc6", shellBuyer: "#e6bcf6", supplierGlow: "#9bf0c0", buyerGlow: "#eac6fa", eyes: "#6fe0a5", eyesIntensity: 0.9, joints: "#1b3158", platform: "#152745", platformEmissive: "#1b3158", metalness: 0.5, roughness: 0.26, keyLight: "#e4f3fd", rimLight: "#a7d9fa", ambient: "#b8c7dd" },
    },
  },
  "arc-midnight": {
    id: "arc-midnight",
    label: "Arc midnight",
    blurb: "Deeper navy, brighter Sail blue and a vivid violet glow.",
    scene: {
      bg: "#070d1c",
      dark: true,
      curve: "#7fc4f2",
      dot: "#e4f3fd",
      env: { key: "#dbe9ff", side: "#8b5cf6", floor: "#7fc4f2" },
      robot: { supplier: "#5eead4", buyer: "#f0abfc", shellSupplier: "#a7f3e4", shellBuyer: "#f5c8fd", supplierGlow: "#8ff5e3", buyerGlow: "#f6c9fd", eyes: "#5eead4", eyesIntensity: 1, joints: "#14224a", platform: "#0d1730", platformEmissive: "#14224a", metalness: 0.55, roughness: 0.24, keyLight: "#dbe9ff", rimLight: "#8b5cf6", ambient: "#9fb2d4" },
    },
  },
  mint: {
    id: "mint",
    label: "Mint",
    blurb: "Warm stone neutrals and a soft mint green. Light, calm and friendly.",
    scene: {
      bg: "#fafaf9",
      dark: false,
      curve: "#1a7f3c",
      dot: "#82de91",
      env: { key: "#ffffff", side: "#82de91", floor: "#ffffff" },
      robot: { supplier: "#4fcf85", buyer: "#8b6cf0", shellSupplier: "#e4f6e8", shellBuyer: "#efe8ff", supplierGlow: "#82de91", buyerGlow: "#b9a5ff", eyes: "#82de91", eyesIntensity: 0.2, joints: "#44403c", platform: "#f5f5f4", platformEmissive: "#e7e6e4", metalness: 0.3, roughness: 0.32, keyLight: "#ffffff", rimLight: "#82de91", ambient: "#ffffff" },
    },
  },
  "mint-dark": {
    id: "mint-dark",
    label: "Mint dark",
    blurb: "The same palette on warm near-black. Used automatically when your system is set to dark.",
    scene: {
      bg: "#100f0e",
      dark: true,
      curve: "#82de91",
      dot: "#e9fbed",
      env: { key: "#f5f5f4", side: "#82de91", floor: "#ffffff" },
      robot: { supplier: "#82de91", buyer: "#a995ff", shellSupplier: "#a8ecb5", shellBuyer: "#d9c9ff", supplierGlow: "#b8efc1", buyerGlow: "#c7b8ff", eyes: "#82de91", eyesIntensity: 0.9, joints: "#292524", platform: "#181716", platformEmissive: "#262322", metalness: 0.5, roughness: 0.26, keyLight: "#f5f5f4", rimLight: "#82de91", ambient: "#d6d3d1" },
    },
  },
};

export const THEME_IDS: ThemeId[] = ["arc", "arc-dark", "arc-midnight", "mint", "mint-dark"];
export const DEFAULT_THEME: ThemeId = "arc";

export const isDarkTheme = (id: ThemeId) => THEMES[id].scene.dark;
/** The other mode of the same family: the switch flips light and dark and keeps the palette. */
export const counterpart = (id: ThemeId): ThemeId => (id === "arc" ? "arc-dark" : id === "mint" ? "mint-dark" : id === "mint-dark" ? "mint" : "arc");
const STORAGE_KEY = "misthos.theme.v1";

/** With no saved choice and no ?theme=, follow the visitor's system setting, as the template does. */
const systemTheme = (): ThemeId => (window.matchMedia("(prefers-color-scheme: dark)").matches ? "arc-dark" : "arc");

let current: ThemeId = DEFAULT_THEME;
const subs = new Set<() => void>();

const isTheme = (v: unknown): v is ThemeId => typeof v === "string" && v in THEMES;

/** Called once on the client before first paint: URL (?theme=), then the saved choice, then the default. */
export function initTheme() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("theme");
    const saved = window.localStorage.getItem(STORAGE_KEY);
    const pick = isTheme(fromUrl) ? fromUrl : isTheme(saved) ? saved : systemTheme();
    setTheme(pick, isTheme(fromUrl));
  } catch {
    setTheme(DEFAULT_THEME, false);
  }
}

export function setTheme(id: ThemeId, persist = true) {
  current = id;
  document.documentElement.dataset.theme = id;
  if (persist) {
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* storage blocked: the choice just will not be remembered */
    }
  }
  subs.forEach((f) => f());
}

export const getTheme = () => current;
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

/** The active theme id. Safe in React DOM and inside a three.js canvas. */
export const useThemeId = (): ThemeId => useSyncExternalStore(subscribe, getTheme, () => DEFAULT_THEME);

/** Script for <head>: sets data-theme before first paint so there is no flash of the wrong colours. */
export const NO_FLASH_SCRIPT = `(function(){try{var q=new URLSearchParams(location.search).get("theme");var s=localStorage.getItem("${STORAGE_KEY}");var t=q||s||(matchMedia("(prefers-color-scheme: dark)").matches?"arc-dark":"arc");if(t&&${JSON.stringify(THEME_IDS)}.indexOf(t)>-1)document.documentElement.setAttribute("data-theme",t)}catch(e){}})();`;
