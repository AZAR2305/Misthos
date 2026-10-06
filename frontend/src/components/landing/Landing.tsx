"use client";

import { useEffect } from "react";
import { Nav } from "./Nav";
import { Hero } from "./Hero";
import { Features } from "./Features";
import { Steps } from "./Steps";
import { Who } from "./Who";
import { Agents } from "./Agents";
import { Evidence } from "./Evidence";
import { Final } from "./Final";
import { sceneState } from "./scene-store";

/** A plain, light page. The only motion is the agents: they follow the cursor, and this keeps the shared pointer up to date. */
export function Landing() {
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

    // Ease the pointer so the agents' heads turn smoothly rather than snapping.
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

  return (
    <div className="landing">
      <Nav />
      <main>
        <Hero />
        <Features />
        <Steps />
        <Who />
        <Agents />
        <Evidence />
        <Final />
      </main>
    </div>
  );
}
