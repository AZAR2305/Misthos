"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Html, Lightformer, PerformanceMonitor, Preload, useAnimations, useGLTF } from "@react-three/drei";
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { THEMES, useThemeId } from "@/lib/themes";
import { sceneState } from "./scene-store";
import { HOME } from "./stage-constants";

/**
 * Two agents on a stage. The robot is "RobotExpressive" by Tomás Laulhé (Quaternius), CC0, with face morph targets by
 * Don McCurdy, as shipped in the three.js examples. They are characters, not widgets: they idle with small gestures of their
 * own, look toward the cursor, walk to meet each other to hand over an offer, and dance when a deal settles. No numbers are
 * shown here: this is an illustration of the protocol's roles and reason codes, never live data (CLAUDE.md 0.5).
 */
const MODEL_URL = "/models/RobotExpressive.glb";

export type Role = "supplier" | "buyer";
export type Pose = "Idle" | "Wave" | "Yes" | "No" | "ThumbsUp" | "Jump" | "Dance";
export type Face = "neutral" | "angry" | "surprised" | "sad";

export interface AgentState {
  pose: Pose;
  /** Increments to re-trigger the same pose. */
  poseKey: number;
  face: Face;
  bubble: string | null;
  /** Typing at a terminal: arms come up to the keyboard, the head tips down, the eyes flicker as it reads. */
  working?: boolean;
  /** Walk to this x (stage units) when `key` changes. Home is HOME[role]. */
  move?: { x: number; key: number };
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
  /** No platform, ring or prop: a single character on its own. */
  bare?: boolean;
}) {
  const group = useRef<THREE.Group>(null!);
  const body = useRef<THREE.Group>(null!);
  const { scene, animations } = useGLTF(MODEL_URL);
  const themeId = useThemeId();
  const th = THEMES[themeId].scene.robot;
  const tint = role === "supplier" ? th.supplier : th.buyer;
  const glow = role === "supplier" ? th.supplierGlow : th.buyerGlow;
  const shadowTex = useShadowTexture();

  // Re-skin the model whenever the theme changes.
  const model = useMemo(() => {
    const c = cloneSkinned(scene) as THREE.Group;
    c.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const next = mats.map((m) => {
        const mat: THREE.MeshStandardMaterial =
          m.name === "Main" ? new THREE.MeshPhysicalMaterial({ name: "Main", clearcoat: 0.7, clearcoatRoughness: 0.26 }) : (m as THREE.MeshStandardMaterial).clone();
        if (mat.name === "Main") {
          mat.color.set(tint);
          mat.metalness = th.metalness;
          mat.roughness = th.roughness;
          mat.emissive.set(tint);
          mat.emissiveIntensity = 0.12;
          mat.envMapIntensity = 1.4;
        } else if (mat.name === "Grey") {
          mat.color.set(th.joints);
          mat.metalness = 0.65;
          mat.roughness = 0.35;
        } else if (mat.name === "Black") {
          mat.color.set("#05060a");
          mat.emissive.set(th.eyes);
          mat.emissiveIntensity = th.eyesIntensity;
          mat.metalness = 0.2;
          mat.roughness = 0.28;
        }
        return mat;
      });
      mesh.material = Array.isArray(mesh.material) ? next : next[0];
    });
    return c;
  }, [scene, tint, th]);

  // The bones and the eye material the procedural layers drive (typing, breathing, eye flicker).
  const parts = useMemo(() => {
    const bone = (n: string) => model.getObjectByName(n) as THREE.Bone | undefined;
    let eyes: THREE.MeshStandardMaterial | undefined;
    model.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if ((o as THREE.Mesh).isMesh && m && !Array.isArray(m) && m.name === "Black") eyes = m as THREE.MeshStandardMaterial;
    });
    return { uaL: bone("UpperArmL"), uaR: bone("UpperArmR"), laL: bone("LowerArmL"), laR: bone("LowerArmR"), head: bone("Head"), eyes };
  }, [model]);
  const workW = useRef(0);
  const desk = useRef<THREE.Group>(null!);
  const tmpA = useMemo(() => new THREE.Quaternion(), []);
  const tmpB = useMemo(() => new THREE.Euler(), []);

  // Normalise size and stand the model on y = 0.
  const fit = useMemo(() => {
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const h = box.max.y - box.min.y;
    if (!Number.isFinite(h) || h <= 0) return { s: 1, y: 0 };
    const s = height / h;
    return { s, y: -box.min.y * s };
  }, [model, height]);

  const { actions, mixer } = useAnimations(animations, body);
  void mixer;
  const morphMeshes = useMemo(() => {
    const out: THREE.Mesh[] = [];
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.morphTargetDictionary && m.morphTargetInfluences) out.push(m);
    });
    return out;
  }, [model]);

  // Head bone for look-at. Only used when the clips animate it (they overwrite it each frame, so the offset never accumulates).
  const head = useMemo(() => {
    const b = model.getObjectByName("Head") ?? model.getObjectByName("Neck");
    const bone = b && (b as THREE.Bone).isBone ? (b as THREE.Bone) : null;
    const animated = !!bone && animations.some((a) => a.tracks.some((t) => t.name.startsWith(`${bone.name}.quaternion`)));
    return animated ? bone : null;
  }, [model, animations]);

  const current = useRef<{ action: THREE.AnimationAction; once: boolean } | null>(null);
  const walking = useRef(false);
  const dir = useRef(1);
  const targetX = useRef<number>(home);
  const posX = useRef<number>(home);
  const nextAmbient = useRef(3 + (role === "buyer" ? 2.5 : 0));
  const look = useRef({ y: 0, x: 0 });
  const tmpQ = useMemo(() => new THREE.Quaternion(), []);
  const tmpE = useMemo(() => new THREE.Euler(), []);

  /** Cross-fade to a clip from whatever is playing: no pops, no stacking. */
  const play = useCallback(
    (name: string, once: boolean, fade = 0.35) => {
      const next = actions[name];
      if (!next) return;
      const prev = current.current?.action;
      next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
      next.clampWhenFinished = true;
      next.reset().play();
      if (prev && prev !== next) prev.crossFadeTo(next, fade, true);
      current.current = { action: next, once };
    },
    [actions],
  );

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
    if (state.poseKey === 0 || walking.current) return;
    if (state.pose === "Dance") play("Dance", false, 0.3);
    else if (state.pose === "Idle") play("Idle", false, 0.4);
    else play(state.pose, ONE_SHOT.includes(state.pose));
  }, [state.poseKey, state.pose, play]);

  useEffect(() => {
    if (state.move) targetX.current = state.move.x;
  }, [state.move?.key, state.move?.x]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05); // a stalled frame must not make the agents jump
    const g = group.current;
    if (!g) return;
    const idle = actions.Idle;

    // --- walking: ease toward the target x, facing the way we go ---
    const dx = targetX.current - posX.current;
    if (Math.abs(dx) > 0.03) {
      dir.current = Math.sign(dx);
      const speed = 1.7 * THREE.MathUtils.clamp(Math.abs(dx) / 0.5, 0.45, 1);
      posX.current += dir.current * Math.min(Math.abs(dx), speed * dt);
      if (!walking.current) {
        walking.current = true;
        play("Walking", false, 0.25);
        if (current.current) current.current.action.timeScale = 1.15;
      }
    } else if (walking.current) {
      walking.current = false;
      posX.current = targetX.current;
      if (actions.Walking) actions.Walking.timeScale = 1;
      play("Idle", false, 0.35);
    }
    g.position.x = posX.current;

    // --- finish one-shots with a blend instead of a snap ---
    const cur = current.current;
    if (!walking.current && cur?.once && idle && cur.action.time >= cur.action.getClip().duration - 0.45) {
      play("Idle", false, 0.45);
    }

    // --- idle life: a small gesture of its own every few seconds ---
    const now = clock.elapsedTime;
    if (!sceneState.reducedMotion && !state.working && !walking.current && state.pose === "Idle" && cur && !cur.once && cur.action === idle && now > nextAmbient.current) {
      play(pickAmbient(Math.random()), true);
      nextAmbient.current = now + 6 + Math.random() * 6;
    }

    // --- face ---
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

    // --- body yaw: face the way it walks, otherwise toward the counterpart and a little toward the cursor ---
    const want = walking.current ? dir.current * 1.25 : yaw + sceneState.pointer.x * 0.28;
    g.rotation.y += (want - g.rotation.y) * (1 - Math.exp(-dt * 6));

    // --- head: follows the cursor (applied after the mixer, which rewrites the bone every frame) ---
    if (head && !walking.current) {
      const ty = THREE.MathUtils.clamp(sceneState.pointer.x * 0.5 * (role === "supplier" ? 1 : -1) * -1, -0.45, 0.45);
      const tx = THREE.MathUtils.clamp(-sceneState.pointer.y * 0.3, -0.3, 0.3);
      look.current.y += (ty - look.current.y) * (1 - Math.exp(-dt * 5));
      look.current.x += (tx - look.current.x) * (1 - Math.exp(-dt * 5));
      tmpE.set(look.current.x, look.current.y, 0);
      tmpQ.setFromEuler(tmpE);
      head.quaternion.multiply(tmpQ);
    }

    // --- breathing: a slow, tiny rise and fall of the whole body ---
    if (body.current) body.current.scale.y = fit.s * (1 + (sceneState.reducedMotion ? 0 : Math.sin(now * 1.7) * 0.008));

    // --- working: ease in and out of a typing posture, applied after the clips so it never accumulates ---
    const target = state.working && !walking.current ? 1 : 0;
    workW.current += (target - workW.current) * (1 - Math.exp(-dt * 4.5));
    const w = workW.current;
    if (w > 0.002) {
      const t = sceneState.reducedMotion ? 0 : now;
      const stroke = (phase: number) => Math.sin(t * 11 + phase) * (sceneState.reducedMotion ? 0 : 1);
      const lift = (b: THREE.Bone | undefined, x: number, z: number) => {
        if (!b) return;
        tmpA.setFromEuler(tmpB.set(x * w, 0, z * w));
        b.quaternion.multiply(tmpA);
      };
      lift(parts.uaL, 1.0 + 0.05 * stroke(0), 0.12);
      lift(parts.uaR, 1.0 + 0.05 * stroke(2.1), -0.12);
      lift(parts.laL, -0.55 + 0.2 * stroke(0.4), 0);
      lift(parts.laR, -0.55 + 0.2 * stroke(2.6), 0);
      lift(parts.head, 0.09 + 0.02 * Math.sin(t * 0.9), 0);
    }
    if (desk.current) {
      desk.current.visible = w > 0.01;
      desk.current.scale.setScalar(Math.max(0.001, w));
    }
    if (parts.eyes) parts.eyes.emissiveIntensity = th.eyesIntensity * (1 + w * (0.6 + 0.4 * Math.sin(now * 7)));
  });

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
      <group ref={body} scale={fit.s} position={[0, fit.y, 0]}>
        <primitive object={model} />
      </group>

      <mesh position={[0, 0.006, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[8, 8]} />
        <shadowMaterial transparent opacity={THEMES[themeId].scene.dark ? 0.35 : 0.2} />
      </mesh>
      {/* Floor: soft contact shadow, a pad and a glowing ring */}
      <mesh position={[0, 0.012, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[1.5, 40]} />
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
      {/* A standing desk and keyboard that rise out of the floor when the agent starts typing. */}
      <group ref={desk} position={[0, 1.12, 0.74]} visible={false}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[1.5, 0.07, 0.78]} />
          <meshStandardMaterial color={th.joints} metalness={0.3} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.06, 0.04]} castShadow>
          <boxGeometry args={[1.0, 0.04, 0.34]} />
          <meshStandardMaterial color={th.platform} metalness={0.2} roughness={0.55} emissive={tint} emissiveIntensity={0.08} />
        </mesh>
        {[-0.1, 0, 0.1].map((z) => (
          <mesh key={z} position={[0, 0.085, z + 0.04]}>
            <boxGeometry args={[0.88, 0.012, 0.045]} />
            <meshStandardMaterial color={tint} emissive={tint} emissiveIntensity={0.5} />
          </mesh>
        ))}
        <mesh position={[0, -0.61, 0]} castShadow>
          <cylinderGeometry args={[0.05, 0.05, 1.18, 12]} />
          <meshStandardMaterial color={th.joints} metalness={0.5} roughness={0.4} />
        </mesh>
      </group>

      {state.bubble && (
        <Html position={[0, AGENT_HEIGHT + 0.55, 0]} center distanceFactor={7} zIndexRange={[20, 0]} className="stage-bubble-wrap">
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

useGLTF.preload(MODEL_URL);
