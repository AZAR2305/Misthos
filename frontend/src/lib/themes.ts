"use client";

import { useSyncExternalStore } from "react";

/**
 * Colour themes. CSS colours live in design/themes.css (selected by data-theme on <html>); this file holds the matching
 * palette for the three.js scenes, which cannot read CSS variables per frame. Keep the two in step.
 *
 * Every theme pairs a cool/warm contrast on purpose: the 3D world and the main action never share a hue, and the agents
 * (the characters) are told apart from the world by colour, so they pop instead of dissolving into it.
 */
export type ThemeId = "emerald" | "violet-night" | "violet-light" | "midnight-coral";

export interface SceneTheme {
  /** Page background: the scene clears to this colour and fogs into it. */
  bg: string;
  dark: boolean;
  /** Crystal ramp, dark to light. Each shard picks a point on it. */
  shard: [string, string, string, string, string];
  shardGloss: { metalness: number; roughness: number; env: number; emissive: string; emissiveIntensity: number };
  arch: { color: string; emissive: string; emissiveIntensity: number; metalness: number; roughness: number; env: number };
  curve: string;
  dot: string;
  light: { ambient: string; ambientIntensity: number; key: string; keyIntensity: number; pointer: string };
  /** Light cards reflected in the glossy surfaces. A warm rim against cool bodies (or the reverse) is what makes them read as real. */
  env: { key: string; side: string; ring: string; stripA: string; stripB: string; floor: string; boost: number };
  dust: { color: string; opacity: number; additive: boolean };
  bloom: { on: boolean; intensity: number; threshold: number };
  vignette: boolean;
  robot: {
    supplier: string;
    buyer: string;
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
  emerald: {
    id: "emerald",
    label: "Emerald night",
    blurb: "Black, emerald crystals, mint actions. Calm and on-brand, but one hue everywhere.",
    scene: {
      bg: "#000000",
      dark: true,
      shard: ["#0a5a39", "#12925a", "#2fcf86", "#8ef0bf", "#d8fbe8"],
      shardGloss: { metalness: 0.42, roughness: 0.15, env: 1.7, emissive: "#06261a", emissiveIntensity: 0.9 },
      arch: { color: "#0f7a4c", emissive: "#052d1d", emissiveIntensity: 0.9, metalness: 0.9, roughness: 0.14, env: 2.6 },
      curve: "#8ef0bf",
      dot: "#e8fff3",
      light: { ambient: "#9fe8c4", ambientIntensity: 0.3, key: "#e8fff3", keyIntensity: 2.4, pointer: "#b4f6d0" },
      env: { key: "#e8fff3", side: "#1dba72", ring: "#3fd98e", stripA: "#8ef0bf", stripB: "#d8fbe8", floor: "#ffffff", boost: 1 },
      dust: { color: "#8ef0bf", opacity: 0.5, additive: true },
      bloom: { on: true, intensity: 0.6, threshold: 0.8 },
      vignette: true,
      robot: { supplier: "#1fae72", buyer: "#8ef0bf", supplierGlow: "#3fd98e", buyerGlow: "#d8fbe8", eyes: "#3fd98e", eyesIntensity: 0.6, joints: "#14281f", platform: "#0a1a13", platformEmissive: "#04170e", metalness: 0.55, roughness: 0.26, keyLight: "#e8fff3", rimLight: "#1dba72", ambient: "#b4f6d0" },
    },
  },
  "violet-night": {
    id: "violet-night",
    label: "Violet night",
    blurb: "Near-black, glossy violet crystals, a sharp lime action colour and warm coral agents against the cool world.",
    scene: {
      bg: "#06050b",
      dark: true,
      shard: ["#241067", "#4f2fe0", "#8b6bff", "#cbb8ff", "#fff3ff"],
      shardGloss: { metalness: 0.5, roughness: 0.1, env: 2.1, emissive: "#150a45", emissiveIntensity: 0.8 },
      arch: { color: "#4c2ce0", emissive: "#1a0a5a", emissiveIntensity: 0.8, metalness: 0.95, roughness: 0.1, env: 2.9 },
      curve: "#c8f560",
      dot: "#f4ffd0",
      light: { ambient: "#a58cff", ambientIntensity: 0.3, key: "#efe8ff", keyIntensity: 2.4, pointer: "#d9c8ff" },
      env: { key: "#f1ebff", side: "#ff4fd8", ring: "#7b52ff", stripA: "#c8f560", stripB: "#cbb8ff", floor: "#ffffff", boost: 1.1 },
      dust: { color: "#cbb8ff", opacity: 0.55, additive: true },
      bloom: { on: true, intensity: 0.7, threshold: 0.78 },
      vignette: true,
      robot: { supplier: "#ff7a4d", buyer: "#6fe7f5", supplierGlow: "#ff9a73", buyerGlow: "#a8f3fb", eyes: "#c8f560", eyesIntensity: 0.9, joints: "#1a1430", platform: "#0f0b22", platformEmissive: "#1a1040", metalness: 0.6, roughness: 0.22, keyLight: "#f1ebff", rimLight: "#8b6bff", ambient: "#cbb8ff" },
    },
  },
  "violet-light": {
    id: "violet-light",
    label: "Daylight violet",
    blurb: "White page, black text, glossy violet glass. Crisp and modern; pink and teal agents stand out cleanly.",
    scene: {
      bg: "#ffffff",
      dark: false,
      shard: ["#2f0f9a", "#5b2cf0", "#9a6dff", "#cdb6ff", "#ffffff"],
      shardGloss: { metalness: 0.62, roughness: 0.1, env: 2.4, emissive: "#2a0f80", emissiveIntensity: 0.25 },
      arch: { color: "#5b2cf0", emissive: "#2a0f80", emissiveIntensity: 0.3, metalness: 0.95, roughness: 0.08, env: 3.2 },
      curve: "#ffffff",
      dot: "#ffffff",
      light: { ambient: "#d9ccff", ambientIntensity: 0.7, key: "#ffffff", keyIntensity: 2.6, pointer: "#ffffff" },
      env: { key: "#ffffff", side: "#ff5c8a", ring: "#9a6dff", stripA: "#ffffff", stripB: "#d9c8ff", floor: "#ffffff", boost: 1.25 },
      dust: { color: "#7b52ff", opacity: 0.45, additive: false },
      bloom: { on: false, intensity: 0, threshold: 1 },
      vignette: false,
      robot: { supplier: "#ff5c8a", buyer: "#1fc8a5", supplierGlow: "#ff8aa9", buyerGlow: "#6fe8cf", eyes: "#2a0f80", eyesIntensity: 0.4, joints: "#1b1430", platform: "#efe9ff", platformEmissive: "#d9ccff", metalness: 0.5, roughness: 0.2, keyLight: "#ffffff", rimLight: "#9a6dff", ambient: "#ffffff" },
    },
  },
  "midnight-coral": {
    id: "midnight-coral",
    label: "Midnight coral",
    blurb: "Deep navy, icy aqua crystals, a coral rim light and coral actions. Warm against cool.",
    scene: {
      bg: "#050914",
      dark: true,
      shard: ["#08374f", "#127f98", "#35cfd8", "#a6f4f0", "#f0ffff"],
      shardGloss: { metalness: 0.45, roughness: 0.13, env: 1.9, emissive: "#05283a", emissiveIntensity: 0.85 },
      arch: { color: "#15869e", emissive: "#052a3a", emissiveIntensity: 0.85, metalness: 0.92, roughness: 0.12, env: 2.7 },
      curve: "#ff8a78",
      dot: "#fff0ec",
      light: { ambient: "#8fdff0", ambientIntensity: 0.3, key: "#eaffff", keyIntensity: 2.3, pointer: "#ffc4b8" },
      env: { key: "#eaffff", side: "#ff6b57", ring: "#35cfd8", stripA: "#ff9a8a", stripB: "#a6f4f0", floor: "#ffffff", boost: 1 },
      dust: { color: "#a6f4f0", opacity: 0.5, additive: true },
      bloom: { on: true, intensity: 0.65, threshold: 0.8 },
      vignette: true,
      robot: { supplier: "#ff6b57", buyer: "#5ce1e6", supplierGlow: "#ff9585", buyerGlow: "#b4f3f5", eyes: "#ffd166", eyesIntensity: 0.8, joints: "#0e1a33", platform: "#0a1730", platformEmissive: "#08203a", metalness: 0.58, roughness: 0.24, keyLight: "#eaffff", rimLight: "#ff6b57", ambient: "#9fe3f0" },
    },
  },
};

export const THEME_IDS: ThemeId[] = ["violet-night", "violet-light", "midnight-coral", "emerald"];
export const DEFAULT_THEME: ThemeId = "violet-night";
const STORAGE_KEY = "misthos.theme.v1";

let current: ThemeId = DEFAULT_THEME;
const subs = new Set<() => void>();

const isTheme = (v: unknown): v is ThemeId => typeof v === "string" && v in THEMES;

/** Called once on the client before first paint: URL (?theme=), then the saved choice, then the default. */
export function initTheme() {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("theme");
    const saved = window.localStorage.getItem(STORAGE_KEY);
    const pick = isTheme(fromUrl) ? fromUrl : isTheme(saved) ? saved : DEFAULT_THEME;
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
export const NO_FLASH_SCRIPT = `(function(){try{var q=new URLSearchParams(location.search).get("theme");var s=localStorage.getItem("${STORAGE_KEY}");var t=q||s;if(t&&${JSON.stringify(THEME_IDS)}.indexOf(t)>-1)document.documentElement.setAttribute("data-theme",t)}catch(e){}})();`;
