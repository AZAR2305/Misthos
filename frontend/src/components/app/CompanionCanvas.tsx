"use client";

import { Canvas } from "@react-three/fiber";
import { PerformanceMonitor, Preload } from "@react-three/drei";
import { Suspense, useState } from "react";
import { Lights, Robot, StageBoundary, type AgentState, type Role } from "@/components/landing/AgentStage";

/** One small agent, full body, standing on the page. The canvas is transparent so it sits right on the app. */
export default function CompanionCanvas({ role, state, visible, onSelect }: { role: Role; state: AgentState; visible: boolean; onSelect: () => void }) {
  const [dpr, setDpr] = useState(1.5);
  return (
    <StageBoundary>
      <Canvas
        shadows="soft"
        camera={{ fov: 28, position: [0, 1.7, 9.2], near: 0.1, far: 40 }}
        dpr={Math.min(dpr, typeof window !== "undefined" ? window.devicePixelRatio : 1)}
        frameloop={visible ? "always" : "never"}
        gl={{ antialias: true, alpha: true }}
        onCreated={({ camera }) => camera.lookAt(0, 1.3, 0)}
      >
        <PerformanceMonitor ms={250} iterations={6} bounds={() => [40, 58]} onDecline={() => setDpr((d) => Math.max(0.85, d - 0.3))} onIncline={() => setDpr((d) => Math.min(1.5, d + 0.3))} />
        <Lights />
        <Suspense fallback={null}>
          <Robot role={role} state={state} active onSelect={onSelect} onHover={() => {}} home={0} yaw={0.15} height={2.7} bare />
          <Preload all />
        </Suspense>
      </Canvas>
    </StageBoundary>
  );
}
