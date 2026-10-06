"use client";

import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor, Preload } from "@react-three/drei";
import { Suspense, useState } from "react";
import { Lights, Robot, StageBoundary, type AgentState, type Role } from "./AgentStage";

/** One agent, large, framed chest-up on a light studio backdrop (the page draws the backdrop; the canvas is transparent). */
export default function HeroCanvas({ role, state, visible, onSelect }: { role: Role; state: AgentState; visible: boolean; onSelect: () => void }) {
  const [dpr, setDpr] = useState(1.5);
  return (
    <StageBoundary>
      <Canvas
        camera={{ fov: 27, position: [0, 1.75, 10.4], near: 0.1, far: 40 }}
        dpr={Math.min(dpr, typeof window !== "undefined" ? window.devicePixelRatio : 1)}
        frameloop={visible ? "always" : "never"}
        gl={{ antialias: true, alpha: true }}
        onCreated={({ camera }) => camera.lookAt(0, 1.5, 0)}
      >
        <PerformanceMonitor ms={250} iterations={6} bounds={() => [40, 58]} onDecline={() => setDpr((d) => Math.max(0.85, d - 0.3))} onIncline={() => setDpr((d) => Math.min(1.5, d + 0.3))} />
        <Lights />
        <Suspense fallback={null}>
          <group position={[0, 0, 0]}>
            <Robot role={role} state={state} active onSelect={onSelect} onHover={() => {}} home={0} yaw={0} height={3.3} bare />
          </group>
          <Preload all />
        </Suspense>
      </Canvas>
    </StageBoundary>
  );
}
