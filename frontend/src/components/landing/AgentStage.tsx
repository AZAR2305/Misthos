"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Html, Lightformer, PerformanceMonitor, Preload } from "@react-three/drei";
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { THEMES, useThemeId } from "@/lib/themes";
import { sceneState } from "./scene-store";
import { HOME } from "./stage-constants";

/**
 * Two agents on a stage, each an abstract "agent core" (see Robot below). They idle with small gestures of their own, look
 * toward the cursor, glide over to hand an offer to each other, and celebrate when a deal settles. No numbers are shown
 * here: this is an illustration of the protocol's roles and reason codes, never live data (CLAUDE.md 0.5).
 */

export type Role = "supplier" | "buyer";
export type Pose = "Idle" | "Wave" | "Yes" | "No" | "ThumbsUp" | "Jump" | "Dance";
export type Face = "neutral" | "angry" | "surprised" | "sad";

export interface AgentState {
  pose: Pose;
  /** Increments to re-trigger the same pose. */
  poseKey: number;
  face: Face;
  bubble: string | null;
  /** Reading or typing at a terminal: the rings spin up, the core tips forward, the eyes scan. */
  working?: boolean;
  /** Walk to this x (stage units) when `key` changes. Home is HOME[role]. */
  move?: { x: number; key: number };
}

export interface Message {
  from: Role;
  key: number;
}


const YAW = { supplier: 0.5, buyer: -0.5 } as const;
const AGENT_HEIGHT = 2.9;
/** Small gestures an agent makes on its own while it waits. */
const AMBIENT: Array<[Pose, number]> = [["Wave", 3], ["Yes", 2], ["No", 1], ["ThumbsUp", 1.5], ["Jump", 0.7]];

const pickAmbient = (r: number): Pose => {
  const total = AMBIENT.reduce((s, [, w]) => s + w, 0);
  let x = r * total;
  for (const [p, w] of AMBIENT) if ((x -= w) <= 0) return p;
  return "Wave";
};

/** A soft contact shadow so the characters sit on the floor instead of floating. */
function useShadowTexture() {
  return useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grad.addColorStop(0, "rgba(0,0,0,0.6)");
    grad.addColorStop(0.55, "rgba(0,0,0,0.22)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
}

/** Eye shapes per face: [scale x, scale y, tilt, brightness]. */
const EYE: Record<Face, [number, number, number, number]> = {
  neutral: [1, 1, 0, 1],
  angry: [1.1, 0.55, 0.38, 1.25],
  surprised: [1.25, 1.5, 0, 1.3],
  sad: [0.9, 0.7, -0.3, 0.45],
};

/**
 * The agent: not a person but a compact "agent core", a glossy shell with a visor and two eyes, gyro rings that carry the
 * negotiation, and (when it stands alone) USDC-style coins in orbit. It floats, looks toward the cursor, nods, shakes,
 * hops and spins. Everything is built from primitives, so there is no model file to download and it takes the theme colours.
 */
export function Robot({
  role,
  state,
  active,
  onSelect,
  onHover,
  home = HOME[role],
  yaw = YAW[role],
  height = AGENT_HEIGHT,
  bare = false,
}: {
  role: Role;
  state: AgentState;
  active: boolean;
  onSelect: () => void;
  onHover: (over: boolean) => void;
  /** Stage x the agent stands at (default: its side of the two-agent stage). */
  home?: number;
  /** Resting body yaw. */
  yaw?: number;
  height?: number;
  /** No platform, ring or prop: a single core on its own, with coins in orbit. */
  bare?: boolean;
}) {
  const group = useRef<THREE.Group>(null!);
  const core = useRef<THREE.Group>(null!);
  const ringA = useRef<THREE.Group>(null!);
  const ringB = useRef<THREE.Group>(null!);
  const ringC = useRef<THREE.Group>(null!);
  const coins = useRef<THREE.Group>(null!);
  const eyeL = useRef<THREE.Mesh>(null!);
  const eyeR = useRef<THREE.Mesh>(null!);
  const shadow = useRef<THREE.Mesh>(null!);
  const themeId = useThemeId();
  const th = THEMES[themeId].scene.robot;
  const tint = role === "supplier" ? th.supplier : th.buyer;
  const glow = role === "supplier" ? th.supplierGlow : th.buyerGlow;
  const shadowTex = useShadowTexture();

  const dark = THEMES[themeId].scene.dark;
  const R = height * 0.24;
  const cy = height * 0.52;
  const eyeMat = useMemo(() => new THREE.MeshBasicMaterial({ color: glow, toneMapped: false }), [glow]);

  const anim = useRef<{ pose: Pose; t0: number }>({ pose: "Idle", t0: -10 });
  const nextAmbient = useRef(3 + (role === "buyer" ? 2.5 : 0));
  const dir = useRef(1);
  const targetX = useRef<number>(home);
  const posX = useRef<number>(home);
  const walking = useRef(false);
  const spin = useRef(0);
  const look = useRef({ y: 0, x: 0 });
  const blink = useRef({ next: 2.5, t0: -1 });
  const eyeNow = useRef<[number, number, number, number]>([1, 1, 0, 1]);

  useEffect(() => {
    if (state.poseKey === 0) return;
    anim.current = { pose: state.pose, t0: performance.now() / 1000 };
  }, [state.poseKey, state.pose]);

  useEffect(() => {
    if (state.move) targetX.current = state.move.x;
  }, [state.move?.key, state.move?.x]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const g = group.current;
    if (!g) return;
    const now = clock.elapsedTime;
    const calm = sceneState.reducedMotion;
    const wall = performance.now() / 1000;

    // --- walking: glide toward the target x, leaning the way it goes ---
    const dx = targetX.current - posX.current;
    walking.current = Math.abs(dx) > 0.03;
    if (walking.current) {
      dir.current = Math.sign(dx);
      const speed = 1.7 * THREE.MathUtils.clamp(Math.abs(dx) / 0.5, 0.45, 1);
      posX.current += dir.current * Math.min(Math.abs(dx), speed * dt);
    } else posX.current = targetX.current;
    g.position.x = posX.current;

    // --- idle life: a small gesture of its own every few seconds ---
    if (!calm && !state.working && !walking.current && state.pose === "Idle" && now > nextAmbient.current) {
      anim.current = { pose: pickAmbient(Math.random()), t0: wall };
      nextAmbient.current = now + 6 + Math.random() * 6;
    }

    // --- pose: a short gesture on top of the float ---
    const tp = wall - anim.current.t0;
    const decay = Math.exp(-tp * 1.7);
    let nodX = 0, shakeY = 0, tiltZ = 0, hop = 0, pulse = 1, spinBoost = 0, ringBoost = 0;
    switch (anim.current.pose) {
      case "Yes": if (tp < 2) nodX = Math.sin(tp * 11) * 0.3 * decay; break;
      case "No": if (tp < 2) shakeY = Math.sin(tp * 13) * 0.55 * decay; break;
      case "Wave": if (tp < 2.2) { tiltZ = Math.sin(tp * 7) * 0.28 * decay; ringBoost = 4 * decay; } break;
      case "ThumbsUp": if (tp < 1.4) { pulse = 1 + 0.16 * Math.sin(Math.min(tp / 0.7, 1) * Math.PI); nodX = Math.sin(tp * 9) * 0.18 * decay; } break;
      case "Jump": if (tp < 1.2) hop = Math.abs(Math.sin(tp * 4.2)) * 0.55 * Math.exp(-tp * 0.9); break;
      case "Dance": if (tp < 3) { hop = Math.abs(Math.sin(tp * 5)) * 0.3; spinBoost = 5 * Math.min(1, (3 - tp)); ringBoost = 3; tiltZ = Math.sin(tp * 5) * 0.18; } break;
      default: break;
    }
    const busy = state.working ? 1 : 0;

    // --- body yaw: face the way it goes, otherwise toward the counterpart and a little toward the cursor ---
    const want = walking.current ? dir.current * 0.5 : yaw + sceneState.pointer.x * 0.28;
    g.rotation.y += (want - g.rotation.y) * (1 - Math.exp(-dt * 6));
    g.rotation.z += ((walking.current ? -dir.current * 0.12 : 0) - g.rotation.z) * (1 - Math.exp(-dt * 6));

    // --- core: float, look at the cursor, gesture ---
    const c = core.current;
    const k = 1 - Math.exp(-dt * 5);
    const ty = walking.current ? 0 : THREE.MathUtils.clamp(sceneState.pointer.x * 0.5 * (role === "supplier" ? 1 : -1) * -1, -0.5, 0.5);
    const tx = walking.current ? 0 : THREE.MathUtils.clamp(-sceneState.pointer.y * 0.3, -0.3, 0.3);
    look.current.y += (ty - look.current.y) * k;
    look.current.x += (tx - look.current.x) * k;
    const bob = calm ? 0 : Math.sin(now * 1.4 + (role === "buyer" ? 1.3 : 0)) * 0.07;
    c.position.y = cy + bob + hop;
    c.rotation.set(look.current.x + nodX + busy * 0.12, look.current.y + shakeY, tiltZ);
    c.scale.setScalar(R * pulse * (calm ? 1 : 1 + Math.sin(now * 1.7) * 0.012));
    if (shadow.current) {
      const s = 1 - (bob + hop) * 0.35;
      shadow.current.scale.set(s, s, s);
    }

    // --- rings: slow gyro; faster when busy, walking or celebrating ---
    const speed = (calm ? 0 : 0.35) + busy * 1.8 + (walking.current ? 0.8 : 0) + ringBoost;
    ringA.current.rotation.z += dt * speed * 1.0;
    ringB.current.rotation.x += dt * speed * 0.8;
    ringC.current.rotation.y -= dt * speed * 0.6;
    spin.current += dt * ((calm ? 0 : 0.25) + spinBoost);
    if (coins.current) coins.current.rotation.y = spin.current + (calm ? 0 : now * 0.2);

    // --- eyes: ease to the face, blink now and then, flicker while reading ---
    const tgt = EYE[state.face];
    for (let i = 0; i < 4; i++) eyeNow.current[i] += (tgt[i] - eyeNow.current[i]) * (1 - Math.exp(-dt * 9));
    if (!calm && now > blink.current.next) {
      blink.current = { next: now + 2.5 + Math.random() * 3.5, t0: now };
    }
    const bt = (now - blink.current.t0) / 0.16;
    const lid = bt >= 0 && bt <= 1 ? Math.abs(1 - 2 * bt) : 1;
    const [sx, sy, tilt, br] = eyeNow.current;
    const scan = busy && !calm ? Math.sin(now * 5) * 0.08 : 0;
    eyeL.current.scale.set(sx, sy * lid, 1);
    eyeR.current.scale.set(sx, sy * lid, 1);
    eyeL.current.rotation.z = tilt;
    eyeR.current.rotation.z = -tilt;
    eyeL.current.position.x = -0.2 + scan;
    eyeR.current.position.x = 0.2 + scan;
    eyeMat.color.set(glow).multiplyScalar(br * (1 + busy * 0.4 * (0.5 + 0.5 * Math.sin(now * 9))));
  });

  const ring = (r: number, w: number) => (
    <>
      <mesh>
        <torusGeometry args={[r, w, 12, 128]} />
        <meshStandardMaterial color={th.joints} metalness={0.85} roughness={0.25} emissive={glow} emissiveIntensity={0.18} />
      </mesh>
      <mesh position={[r, 0, 0]}>
        <sphereGeometry args={[w * 3.2, 16, 16]} />
        <meshBasicMaterial color={glow} toneMapped={false} />
      </mesh>
    </>
  );

  return (
    <group
      ref={group}
      position={[home, 0, 0]}
      rotation={[0, yaw, 0]}
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
      {/* The core. Unit radius; scaled by the group. */}
      <group ref={core} position={[0, cy, 0]} scale={R}>
        <mesh castShadow>
          <sphereGeometry args={[1, 64, 64]} />
          <meshPhysicalMaterial color={dark ? "#26241f" : "#f2f1ee"} metalness={dark ? 0.75 : 0.35} roughness={dark ? 0.22 : 0.18} clearcoat={1} clearcoatRoughness={0.1} envMapIntensity={1.6} emissive={tint} emissiveIntensity={dark ? 0.05 : 0.02} />
        </mesh>
        {/* Visor */}
        <mesh position={[0, 0.06, 0.62]} scale={[0.78, 0.42, 0.45]}>
          <sphereGeometry args={[1, 48, 48]} />
          <meshPhysicalMaterial color="#05060a" metalness={0.6} roughness={0.08} clearcoat={1} clearcoatRoughness={0.05} envMapIntensity={1.2} />
        </mesh>
        <mesh ref={eyeL} position={[-0.2, 0.08, 1.06]} material={eyeMat}>
          <capsuleGeometry args={[0.065, 0.12, 8, 16]} />
        </mesh>
        <mesh ref={eyeR} position={[0.2, 0.08, 1.06]} material={eyeMat}>
          <capsuleGeometry args={[0.065, 0.12, 8, 16]} />
        </mesh>
        {/* Equator band: the agent's colour */}
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.32, 0]} scale={[0.95, 0.95, 1]}>
          <torusGeometry args={[1, 0.012, 8, 128]} />
          <meshBasicMaterial color={glow} toneMapped={false} />
        </mesh>
        {/* Antenna: a small signal node on top */}
        <mesh position={[0, 1.18, 0]}>
          <cylinderGeometry args={[0.025, 0.025, 0.3, 12]} />
          <meshStandardMaterial color={th.joints} metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0, 1.38, 0]}>
          <sphereGeometry args={[0.09, 16, 16]} />
          <meshBasicMaterial color={glow} toneMapped={false} />
        </mesh>
        {/* Gyro rings */}
        <group ref={ringA} rotation={[Math.PI / 2.4, 0, 0]}>{ring(1.55, 0.014)}</group>
        <group ref={ringB} rotation={[0.3, 0, Math.PI / 2.8]}>{ring(1.8, 0.011)}</group>
        <group ref={ringC} rotation={[Math.PI / 2, 0, 0.5]}>{ring(2.05, 0.009)}</group>
      </group>

      {/* USDC-style coins in orbit, when the agent stands alone. */}
      {bare && (
        <group ref={coins} position={[0, cy + R * 0.2, 0]}>
          {[0, 1, 2].map((i) => {
            const a = (i / 3) * Math.PI * 2;
            const r = R * 2.45;
            return (
              <group key={i} position={[Math.sin(a) * r, Math.sin(a * 2) * R * 0.35, Math.cos(a) * r]} rotation={[0, a, 0]}>
                <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
                  <cylinderGeometry args={[R * 0.2, R * 0.2, R * 0.04, 48]} />
                  <meshStandardMaterial color={THEMES[themeId].scene.dark ? "#e9fbed" : "#ffffff"} metalness={0.7} roughness={0.22} emissive={glow} emissiveIntensity={0.18} />
                </mesh>
                <mesh position={[0, 0, R * 0.025]}>
                  <torusGeometry args={[R * 0.135, R * 0.01, 8, 40]} />
                  <meshBasicMaterial color={glow} toneMapped={false} />
                </mesh>
              </group>
            );
          })}
        </group>
      )}

      <mesh position={[0, 0.006, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[8, 8]} />
        <shadowMaterial transparent opacity={THEMES[themeId].scene.dark ? 0.35 : 0.2} />
      </mesh>
      <mesh ref={shadow} position={[0, 0.012, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[R * 1.7, 40]} />
        <meshBasicMaterial map={shadowTex} transparent depthWrite={false} />
      </mesh>
      {!bare && (
        <>
          <mesh position={[0, 0.02, 0]} rotation-x={-Math.PI / 2}>
            <circleGeometry args={[1.45, 64]} />
            <meshStandardMaterial color={th.platform} metalness={0.4} roughness={0.45} emissive={th.platformEmissive} emissiveIntensity={0.7} />
          </mesh>
          <mesh position={[0, 0.035, 0]} rotation-x={-Math.PI / 2}>
            <ringGeometry args={[1.38, 1.45, 64]} />
            <meshBasicMaterial color={glow} toneMapped={false} opacity={active ? 1 : 0.55} transparent />
          </mesh>
          {role === "supplier" ? <InvoiceProp accent={tint} /> : <TreasuryProp accent={tint} />}
        </>
      )}

      {state.bubble && (
        <Html position={[0, cy + R * 2.6, 0]} center distanceFactor={7} zIndexRange={[20, 0]} className="stage-bubble-wrap">
          <div className="stage-bubble">
            <span className="tag">Agent</span> {state.bubble}
          </div>
        </Html>
      )}
    </group>
  );
}

/** The supplier carries a floating invoice. No amounts: it is a prop, not data. */
function InvoiceProp({ accent }: { accent: string }) {
  const ref = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => {
    const t = sceneState.reducedMotion ? 0 : clock.elapsedTime;
    ref.current.position.y = 1.55 + Math.sin(t * 1.2) * 0.07;
    ref.current.rotation.y = -0.5 + Math.sin(t * 0.6) * 0.12;
  });
  return (
    <group ref={ref} position={[-1.15, 1.55, 0.5]}>
      <mesh>
        <boxGeometry args={[0.72, 0.95, 0.03]} />
        <meshStandardMaterial color="#f7f7fb" metalness={0.1} roughness={0.5} emissive={accent} emissiveIntensity={0.12} />
      </mesh>
      {[0.3, 0.12, -0.06, -0.24].map((y, i) => (
        <mesh key={i} position={[i === 0 ? -0.05 : 0, y, 0.02]}>
          <boxGeometry args={[i === 0 ? 0.42 : 0.52, 0.045, 0.01]} />
          <meshStandardMaterial color={i === 0 ? accent : "#8b90a6"} />
        </mesh>
      ))}
      <mesh position={[0.2, -0.36, 0.02]}>
        <boxGeometry args={[0.22, 0.08, 0.01]} />
        <meshStandardMaterial color={accent} />
      </mesh>
    </group>
  );
}

/** The buyer carries a stack of coins, its treasury. */
function TreasuryProp({ accent }: { accent: string }) {
  const ref = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => {
    const t = sceneState.reducedMotion ? 0 : clock.elapsedTime;
    ref.current.position.y = 1.35 + Math.sin(t * 1.1 + 1) * 0.07;
    ref.current.rotation.y = t * 0.5;
  });
  return (
    <group ref={ref} position={[1.15, 1.35, 0.5]}>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} position={[(i % 2) * 0.03, i * 0.1 - 0.2, 0]}>
          <cylinderGeometry args={[0.3, 0.3, 0.085, 28]} />
          <meshStandardMaterial color={accent} metalness={0.85} roughness={0.2} emissive={accent} emissiveIntensity={0.18} />
        </mesh>
      ))}
    </group>
  );
}

const CHANNEL = new THREE.QuadraticBezierCurve3(
  new THREE.Vector3(HOME.supplier + 0.2, 2.05, 0.25),
  new THREE.Vector3(0, 3.6, 0.2),
  new THREE.Vector3(HOME.buyer - 0.2, 2.05, 0.25),
);

/** The arc between the agents: the negotiation channel. A packet travels it when a message is sent. */
function Channel({ message, pulseKey }: { message: Message | null; pulseKey: number }) {
  const packet = useRef<THREE.Mesh>(null!);
  const pulse = useRef<THREE.Mesh>(null!);
  const clock0 = useRef({ msg: -1, pulse: -1 });
  const th = THEMES[useThemeId()].scene;
  const points = useMemo(() => CHANNEL.getPoints(48), []);
  const dots = useMemo(() => new THREE.BufferGeometry().setFromPoints(points), [points]);

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
        <pointsMaterial color={th.dark ? th.curve : "#6a38f0"} size={0.045} sizeAttenuation transparent opacity={0.8} />
      </points>
      <mesh ref={packet} visible={false}>
        <sphereGeometry args={[0.1, 16, 16]} />
        <meshBasicMaterial color={th.dark ? th.dot : th.robot.supplier} toneMapped={false} />
      </mesh>
      <mesh ref={pulse} position={[0, 0.06, 0.4]} rotation-x={-Math.PI / 2} visible={false}>
        <ringGeometry args={[0.92, 1, 64]} />
        <meshBasicMaterial color={th.curve} transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

export class StageBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
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
  /** The arc between the agents. Off when something (the terminal) sits between them. */
  showChannel?: boolean;
}

/** Keeps both agents in frame whatever the canvas shape: on a narrow phone canvas the camera simply backs off. */
function FitCamera() {
  const { camera, size } = useThree();
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera;
    const halfWidth = Math.abs(HOME.supplier) + 1.9;
    const need = halfWidth / (Math.tan((cam.fov * Math.PI) / 360) * (size.width / size.height));
    cam.position.z = Math.max(9.4, need);
    cam.position.y = 3.2 + (cam.position.z - 9.4) * 0.12;
    cam.lookAt(0, 1.4, 0);
    cam.updateProjectionMatrix();
  }, [camera, size.width, size.height]);
  return null;
}

export function Lights() {
  const th = THEMES[useThemeId()].scene;
  const r = th.robot;
  return (
    <>
      <ambientLight intensity={th.dark ? 0.55 : 0.9} color={r.ambient} />
      <directionalLight
        position={[3, 6, 5]}
        intensity={th.dark ? 2.4 : 2.6}
        color={r.keyLight}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0006}
        shadow-radius={5}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-3}
        shadow-camera-near={1}
        shadow-camera-far={20}
      />
      <directionalLight position={[-5, 2, 3]} intensity={1.8} color={r.rimLight} />
      <Environment key={`env-${th.bg}`} resolution={128} frames={1}>
        <Lightformer form="rect" intensity={3.5} color={th.env.key} position={[3, 4, 4]} scale={[6, 3, 1]} />
        <Lightformer form="rect" intensity={2.6} color={th.env.side} position={[-5, 1, 3]} scale={[3, 6, 1]} />
        <Lightformer form="rect" intensity={1.4} color={th.env.floor} position={[0, -4, 2]} scale={[8, 1, 1]} />
      </Environment>
    </>
  );
}

export default function AgentStage(p: StageProps) {
  const [dpr, setDpr] = useState(1.5);
  return (
    <StageBoundary>
      <Canvas
        shadows="soft"
        camera={{ fov: 31, position: [0, 3.2, 9.4], near: 0.1, far: 40 }}
        dpr={Math.min(dpr, typeof window !== "undefined" ? window.devicePixelRatio : 1)}
        frameloop={p.visible ? "always" : "never"}
        gl={{ antialias: true, alpha: true }}
        onCreated={({ camera }) => camera.lookAt(0, 1.4, 0)}
      >
        <PerformanceMonitor ms={250} iterations={6} bounds={() => [40, 58]} onDecline={() => setDpr((d) => Math.max(0.85, d - 0.3))} onIncline={() => setDpr((d) => Math.min(1.5, d + 0.3))} />
        <Lights />
        <FitCamera />
        <Suspense fallback={null}>
          <Robot role="supplier" state={p.supplier} active={p.selected === "supplier"} onSelect={() => p.onSelect("supplier")} onHover={(o) => p.onHover("supplier", o)} />
          <Robot role="buyer" state={p.buyer} active={p.selected === "buyer"} onSelect={() => p.onSelect("buyer")} onHover={(o) => p.onHover("buyer", o)} />
          {p.showChannel !== false && <Channel message={p.message} pulseKey={p.pulseKey} />}
          <Preload all />
        </Suspense>
      </Canvas>
    </StageBoundary>
  );
}

