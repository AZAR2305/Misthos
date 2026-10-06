"use client";

import dynamic from "next/dynamic";
import Lenis from "lenis";
import { useEffect, useState } from "react";
import { Nav } from "./Nav";
import { Hero } from "./Hero";
import { Features } from "./Features";
import { Steps } from "./Steps";
import { Agents } from "./Agents";
import { Evidence } from "./Evidence";
import { Final } from "./Final";
import { runTicks, sample, sceneState, type Keyframes } from "./scene-store";

const ShardScene = dynamic(() => import("./ShardScene"), { ssr: false });

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

function buildKeys() {
  const vh = window.innerHeight;
  const el = (id: string) => document.getElementById(id) as HTMLElement;
  const steps = el("steps").offsetTop;
  const stepsLen = el("steps").offsetHeight - vh;
  const agents = el("agents").offsetTop;
  const final = el("final").offsetTop;
  const p: Keyframes = [
    [0, 0],
    [vh * 0.2, 0],
    [vh * 0.95, 1],
    [steps - vh * 0.55, 1],
    [steps + vh * 0.12, 2],
    [steps + stepsLen, 2],
    [agents + vh * 0.35, 1],
    [final - vh * 1.1, 1],
    [final - vh * 0.1, 3],
  ];
  const mark: Keyframes = [
    [0, 0],
    [steps + stepsLen * 0.1, 0],
    [steps + stepsLen * 0.3, 1],
    [steps + stepsLen + vh * 0.05, 1],
    [agents + vh * 0.15, 0],
    [final - vh * 0.9, 0],
    [final - vh * 0.1, 1],
  ];
  return { p, mark };
}

export function Landing() {
  const [gl, setGl] = useState<boolean | null>(null);

  useEffect(() => {
    setGl(hasWebGL());
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    sceneState.reducedMotion = reduced.matches;
    const onReduced = () => (sceneState.reducedMotion = reduced.matches);
    reduced.addEventListener("change", onReduced);

    const lenis = new Lenis({ lerp: 0.1, smoothWheel: !reduced.matches });
    let keys = buildKeys();
    const measure = () => {
      sceneState.vh = window.innerHeight;
      keys = buildKeys();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener("resize", measure);

    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      const y = lenis.scroll;
      sceneState.scrollY = y;
      sceneState.p = sample(keys.p, y);
      sceneState.mark = sample(keys.mark, y);
      runTicks(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const onMove = (e: PointerEvent) => {
      sceneState.pointer.active = true;
      sceneState.pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
      sceneState.pointer.ty = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
      ro.disconnect();
      reduced.removeEventListener("change", onReduced);
      window.removeEventListener("resize", measure);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <div className="landing">
      {gl && (
        <div className="landing-canvas" aria-hidden>
          <ShardScene />
        </div>
      )}
      <Nav />
      <main>
        <Hero />
        <Features />
        <Steps />
        <Agents />
        <Evidence />
        <Final />
      </main>
    </div>
  );
}
