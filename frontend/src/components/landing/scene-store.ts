"use client";

import { useEffect } from "react";

/**
 * Shared, mutable state for the 3D agents. Written by the page, read every frame by the three.js canvases. It is
 * deliberately not React state: the pointer fires far too often for that.
 */
export const sceneState = {
  pointer: { x: 0, y: 0, tx: 0, ty: 0, active: false },
  reducedMotion: false,
};

/** Keeps the shared pointer and the reduced-motion flag current. Mount it once on any page that shows an agent. */
export function useSceneInput() {
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    sceneState.reducedMotion = reduced.matches;
    const onReduced = () => (sceneState.reducedMotion = reduced.matches);
    reduced.addEventListener("change", onReduced);

    const p = sceneState.pointer;
    const onMove = (e: PointerEvent) => {
      p.active = true;
      p.tx = (e.clientX / window.innerWidth) * 2 - 1;
      p.ty = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    // Ease the pointer so heads turn smoothly rather than snapping.
    let raf = 0;
    const loop = () => {
      p.x += (p.tx - p.x) * 0.08;
      p.y += (p.ty - p.y) * 0.08;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      reduced.removeEventListener("change", onReduced);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);
}
