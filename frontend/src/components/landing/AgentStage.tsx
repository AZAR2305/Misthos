"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Html, Lightformer, PerformanceMonitor, Preload, useAnimations, useGLTF } from "@react-three/drei";
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { sceneState } from "./scene-store";

/**
 * Two agents on a stage. The robot is "RobotExpressive" by Tomás Laulhé (Quaternius), CC0, with
 * face morph targets by Don McCurdy, as shipped in the three.js examples. We restyle it with the Arc
 * tokens and give each agent its own prop. No numbers are shown here: this is an illustration of the
 * protocol's roles and reason codes, never live data (CLAUDE.md 0.5).
 */
const MODEL_URL = "/models/RobotExpressive.glb";

export type Role = "supplier" | "buyer";
export type Pose = "Idle" | "Wave" | "Yes" | "No" | "ThumbsUp" | "Jump";
export type Face = "neutral" | "angry" | "surprised" | "sad";

export interface AgentState {
  pose: Pose;
  /** Increments to re-trigger the same pose. */
  poseKey: number;
  face: Face;
  bubble: string | null;
}

export interface Message {
  from: Role;
  key: number;
}

const ONE_SHOT: Pose[] = ["Wave", "Yes", "No", "ThumbsUp", "Jump"];
const FACE_TARGET: Record<Face, [number, number, number]> = {
  neutral: [0, 0, 0],
  angry: [0.9, 0, 0],
  surprised: [0, 0.85, 0],
  sad: [0, 0, 0.9],
};

const TINT = { supplier: "#9C6AAA", buyer: "#7FC4F2" } as const; // Bossanova 500 and Sail 400
const GLOW = { supplier: "#CDB1D6", buyer: "#A7D9FA" } as const; // Boss 300 and Sail 300
const X = { supplier: -2.05, buyer: 2.05 } as const;
const YAW = { supplier: 0.5, buyer: -0.5 } as const;
const AGENT_HEIGHT = 2.5;

function Robot({
  role,
  state,
  active,
  onSelect,
  onHover,
}: {
  role: Role;
  state: AgentState;
  active: boolean;
  onSelect: () => void;
  onHover: (over: boolean) => void;
}) {
  const group = useRef<THREE.Group>(null!);
  const body = useRef<THREE.Group>(null!);
  const { scene, animations } = useGLTF(MODEL_URL);
  const model = useMemo(() => {
    const c = cloneSkinned(scene) as THREE.Group;
    c.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const next = mats.map((m) => {
        const mat = (m as THREE.MeshStandardMaterial).clone();
        if (mat.name === "Main") {
          mat.color.set(TINT[role]);
          mat.metalness = 0.35;
          mat.roughness = 0.38;
          mat.emissive.set(TINT[role]);
          mat.emissiveIntensity = 0.12;
        } else if (mat.name === "Grey") {
          mat.color.set("#2A4474");
          mat.metalness = 0.6;
          mat.roughness = 0.4;
        } else if (mat.name === "Black") {
          mat.color.set("#0A1428");
          mat.metalness = 0.2;
          mat.roughness = 0.35;
        }
        return mat;
      });
      mesh.material = Array.isArray(mesh.material) ? next : next[0];
    });
    return c;
  }, [scene, role]);

  // Normalise size and stand the model on y = 0.
  const fit = useMemo(() => {
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const h = box.max.y - box.min.y;
    if (!Number.isFinite(h) || h <= 0) return { s: 1, y: 0 };
    const s = AGENT_HEIGHT / h;
    return { s, y: -box.min.y * s };
  }, [model]);

  const { actions, mixer } = useAnimations(animations, body);
  const morphMeshes = useMemo(() => {
    const out: THREE.Mesh[] = [];
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.morphTargetDictionary && m.morphTargetInfluences) out.push(m);
    });
    return out;
  }, [model]);

  // Current action, so every change is a proper cross-fade from whatever is playing (no pops, no stacking).
  const current = useRef<{ action: THREE.AnimationAction; once: boolean } | null>(null);

  useEffect(() => {
    const idle = actions.Idle;
    if (!idle) return;
    idle.reset().setEffectiveWeight(1).fadeIn(0.5).play();
    current.current = { action: idle, once: false };
    return () => {
      idle.fadeOut(0.2);
    };
  }, [actions]);

  useEffect(() => {
    if (state.poseKey === 0) return;
    const next = actions[state.pose];
    const prev = current.current?.action;
    if (!next || !prev) return;
    const once = ONE_SHOT.includes(state.pose);
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = true;
    next.reset().play();
    if (prev !== next) prev.crossFadeTo(next, 0.35, true);
    else next.setEffectiveWeight(1);
    current.current = { action: next, once };
  }, [state.poseKey, state.pose, actions]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05); // a stalled frame must not make the agents jump
    // Ease back to idle shortly before a one-shot clip ends, so the finish blends instead of snapping.
    const cur = current.current;
    const idle = actions.Idle;
    if (cur?.once && idle) {
      const dur = cur.action.getClip().duration;
      if (cur.action.time >= dur - 0.45) {
        idle.reset().play();
        cur.action.crossFadeTo(idle, 0.45, true);
        current.current = { action: idle, once: false };
      }
    }
    const targets = FACE_TARGET[state.face];
    const k = 1 - Math.exp(-dt * 9);
    for (const m of morphMeshes) {
      const dict = m.morphTargetDictionary!;
      const inf = m.morphTargetInfluences!;
      ["Angry", "Surprised", "Sad"].forEach((name, i) => {
        const idx = dict[name];
        if (idx !== undefined) inf[idx] += (targets[i] - inf[idx]) * k;
      });
    }
    if (group.current) {
      const want = YAW[role] + sceneState.pointer.x * 0.28;
      group.current.rotation.y += (want - group.current.rotation.y) * (1 - Math.exp(-dt * 5));
    }
  });

  return (
    <group
      ref={group}
      position={[X[role], 0, 0]}
      rotation={[0, YAW[role], 0]}
      onPointerOver={(e) => {
        e.stopPropagation();
        document.body.style.cursor = "pointer";
        onHover(true);
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
        onHover(false);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <group ref={body} scale={fit.s} position={[0, fit.y, 0]}>
        <primitive object={model} />
      </group>

      {/* Platform */}
      <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[1.45, 64]} />
        <meshStandardMaterial color="#1B3158" metalness={0.35} roughness={0.55} emissive="#0F1D36" emissiveIntensity={0.6} />
      </mesh>
      <mesh position={[0, 0.035, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[1.38, 1.45, 64]} />
        <meshBasicMaterial color={GLOW[role]} toneMapped={false} opacity={active ? 1 : 0.55} transparent />
      </mesh>

      {role === "supplier" ? <InvoiceProp /> : <TreasuryProp />}

      {state.bubble && (
        <Html position={[0, AGENT_HEIGHT + 0.55, 0]} center distanceFactor={7} zIndexRange={[20, 0]} className="stage-bubble-wrap">
          <div className="stage-bubble">
            <span className="tag">{"{agent}"}</span> {state.bubble}
          </div>
        </Html>
      )}
    </group>
  );
}

/** The supplier carries a floating invoice. No amounts: it is a prop, not data. */
function InvoiceProp() {
  const ref = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => {
    const t = sceneState.reducedMotion ? 0 : clock.elapsedTime;
    ref.current.position.y = 1.55 + Math.sin(t * 1.2) * 0.07;
    ref.current.rotation.y = -0.5 + Math.sin(t * 0.6) * 0.12;
  });
  return (
    <group ref={ref} position={[1.15, 1.55, 0.5]}>
      <mesh>
        <boxGeometry args={[0.72, 0.95, 0.03]} />
        <meshStandardMaterial color="#F2F9FE" metalness={0.1} roughness={0.5} emissive="#CDB1D6" emissiveIntensity={0.18} />
      </mesh>
      {[0.3, 0.12, -0.06, -0.24].map((y, i) => (
        <mesh key={i} position={[i === 0 ? -0.05 : 0, y, 0.02]}>
          <boxGeometry args={[i === 0 ? 0.42 : 0.52, 0.045, 0.01]} />
          <meshStandardMaterial color={i === 0 ? "#663A73" : "#8FA3C2"} />
        </mesh>
      ))}
      <mesh position={[0.2, -0.36, 0.02]}>
        <boxGeometry args={[0.22, 0.08, 0.01]} />
        <meshStandardMaterial color="#663A73" />
      </mesh>
    </group>
  );
}

/** The buyer carries a stack of USDC-blue coins, its treasury. */
function TreasuryProp() {
  const ref = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => {
    const t = sceneState.reducedMotion ? 0 : clock.elapsedTime;
    ref.current.position.y = 1.35 + Math.sin(t * 1.1 + 1) * 0.07;
    ref.current.rotation.y = t * 0.5;
  });
  return (
    <group ref={ref} position={[-1.15, 1.35, 0.5]}>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} position={[(i % 2) * 0.03, i * 0.1 - 0.2, 0]}>
          <cylinderGeometry args={[0.3, 0.3, 0.085, 28]} />
          <meshStandardMaterial color="#A7D9FA" metalness={0.85} roughness={0.22} emissive="#4FA8E3" emissiveIntensity={0.25} />
        </mesh>
      ))}
    </group>
  );
}

const CHANNEL = new THREE.QuadraticBezierCurve3(
  new THREE.Vector3(X.supplier + 0.2, 2.05, 0.25),
  new THREE.Vector3(0, 3.6, 0.2),
  new THREE.Vector3(X.buyer - 0.2, 2.05, 0.25),
);

/** The arc between the agents: the negotiation channel. A packet travels it when a message is sent. */
function Channel({ message, pulseKey }: { message: Message | null; pulseKey: number }) {
  const packet = useRef<THREE.Mesh>(null!);
  const pulse = useRef<THREE.Mesh>(null!);
  const clock0 = useRef({ msg: -1, pulse: -1 });
  const points = useMemo(() => CHANNEL.getPoints(48), []);
  const dots = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints(points);
    return g;
  }, [points]);

  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    if (message && clock0.current.msg !== message.key) clock0.current.msg = now;
    const mt = message ? (now - clock0.current.msg) / 0.9 : 2;
    if (packet.current) {
      packet.current.visible = mt >= 0 && mt <= 1;
      if (packet.current.visible) {
        const e = mt * mt * (3 - 2 * mt);
        const k = message?.from === "supplier" ? e : 1 - e;
        packet.current.position.copy(CHANNEL.getPoint(k));
      }
    }
    if (pulseKey && clock0.current.pulse !== pulseKey) clock0.current.pulse = now;
    const pt = pulseKey ? (now - clock0.current.pulse) / 1.3 : 2;
    if (pulse.current) {
      pulse.current.visible = pt >= 0 && pt <= 1;
      const s = 0.2 + pt * 4.2;
      pulse.current.scale.set(s, s, s);
      (pulse.current.material as THREE.MeshBasicMaterial).opacity = 1 - pt;
    }
  });

  return (
    <group>
      <points geometry={dots}>
        <pointsMaterial color="#CDB1D6" size={0.045} sizeAttenuation transparent opacity={0.8} />
      </points>
      <mesh ref={packet} visible={false}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshBasicMaterial color="#A7D9FA" toneMapped={false} />
      </mesh>
      <mesh ref={pulse} position={[0, 0.06, 0.4]} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[0.92, 1, 64]} />
        <meshBasicMaterial color="#A7D9FA" transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

class StageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return <p className="stage-error">The agent models could not load. Reload the page to try again.</p>;
    }
    return this.props.children;
  }
}

export interface StageProps {
  supplier: AgentState;
  buyer: AgentState;
  selected: Role;
  onSelect: (r: Role) => void;
  onHover: (r: Role, over: boolean) => void;
  message: Message | null;
  pulseKey: number;
  visible: boolean;
}

export default function AgentStage(p: StageProps) {
  const [dpr, setDpr] = useState(1.5);
  return (
    <StageBoundary>
      <Canvas
        camera={{ fov: 32, position: [0, 3.1, 8.4], near: 0.1, far: 40 }}
        dpr={Math.min(dpr, typeof window !== "undefined" ? window.devicePixelRatio : 1)}
        frameloop={p.visible ? "always" : "never"}
        gl={{ antialias: true, alpha: true }}
        onCreated={({ camera }) => camera.lookAt(0, 1.55, 0)}
      >
        <PerformanceMonitor ms={250} iterations={6} bounds={() => [40, 58]} onDecline={() => setDpr((d) => Math.max(0.85, d - 0.3))} onIncline={() => setDpr((d) => Math.min(1.5, d + 0.3))} />
        <ambientLight intensity={0.5} color="#B8C7DD" />
        <directionalLight position={[3, 6, 5]} intensity={2.4} color="#CBE8FB" />
        <directionalLight position={[-5, 2, 3]} intensity={1.6} color="#9C6AAA" />
        <Environment resolution={128} frames={1}>
          <Lightformer form="rect" intensity={3.5} color="#CBE8FB" position={[3, 4, 4]} scale={[6, 3, 1]} />
          <Lightformer form="rect" intensity={2.5} color="#9C6AAA" position={[-5, 1, 3]} scale={[3, 6, 1]} />
          <Lightformer form="rect" intensity={1.2} color="#ffffff" position={[0, -4, 2]} scale={[8, 1, 1]} />
        </Environment>
        <Suspense fallback={null}>
          <Robot
            role="supplier"
            state={p.supplier}
            active={p.selected === "supplier"}
            onSelect={() => p.onSelect("supplier")}
            onHover={(o) => p.onHover("supplier", o)}
          />
          <Robot
            role="buyer"
            state={p.buyer}
            active={p.selected === "buyer"}
            onSelect={() => p.onSelect("buyer")}
            onHover={(o) => p.onHover("buyer", o)}
          />
          <Channel message={p.message} pulseKey={p.pulseKey} />
          <Preload all />
        </Suspense>
      </Canvas>
    </StageBoundary>
  );
}

useGLTF.preload(MODEL_URL);
