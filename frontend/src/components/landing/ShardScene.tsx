"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer, PerformanceMonitor } from "@react-three/drei";
import { Bloom, EffectComposer, SMAA, Vignette } from "@react-three/postprocessing";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { sceneState } from "./scene-store";
import { archMarkGeometry, buildShardSet, crystalGeometry, wedgeGeometry, type ShardSet } from "./shards";

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (t: number) => t * t * (3 - 2 * t);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

function ShardField({ set, geometry }: { set: ShardSet; geometry: THREE.BufferGeometry }) {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const tmp = useMemo(
    () => ({
      pos: new THREE.Vector3(),
      scale: new THREE.Vector3(),
      q0: new THREE.Quaternion(),
      q1: new THREE.Quaternion(),
      qz: new THREE.Quaternion(),
      qs: new THREE.Quaternion(),
      m: new THREE.Matrix4(),
    }),
    [],
  );

  useLayoutEffect(() => {
    const m = mesh.current;
    const c = new THREE.Color();
    for (let i = 0; i < set.count; i++) {
      c.setRGB(set.color[i * 3], set.color[i * 3 + 1], set.color[i * 3 + 2]);
      m.setColorAt(i, c);
    }
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [set]);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const reduced = sceneState.reducedMotion;
    const t = reduced ? 0 : clock.elapsedTime;
    const intro = reduced ? 1 : clamp((clock.elapsedTime - 0.15) / 3.4);
    const p = clamp(sceneState.p, 0, 3);
    const a = Math.min(Math.floor(p), 2);
    const b = a + 1;
    const u = p - a;
    const FA = set.formations[a];
    const FB = set.formations[b];
    const { pos, scale, q0, q1, qz, qs, m: mat } = tmp;
    const orbitBase = t * 0.045;
    const xScale = clamp(sceneState.aspect / 1.6, 0.4, 1);

    for (let i = 0; i < set.count; i++) {
      const raw = clamp((u - set.delay[i] * 0.5) / 0.5);
      const e = smooth(raw);
      const ix = i * 3;
      const iq = i * 4;
      // Most shards sit on a formation most of the time: skip the blends when e is exactly 0 or 1.
      if (e === 0 || e === 1) {
        const F = e === 0 ? FA : FB;
        pos.set(F.pos[ix], F.pos[ix + 1], F.pos[ix + 2]);
        scale.set(F.scale[ix], F.scale[ix + 1], F.scale[ix + 2]);
        q0.set(F.quat[iq], F.quat[iq + 1], F.quat[iq + 2], F.quat[iq + 3]);
      } else {
        pos.set(
          FA.pos[ix] + (FB.pos[ix] - FA.pos[ix]) * e,
          FA.pos[ix + 1] + (FB.pos[ix + 1] - FA.pos[ix + 1]) * e,
          FA.pos[ix + 2] + (FB.pos[ix + 2] - FA.pos[ix + 2]) * e,
        );
        scale.set(
          FA.scale[ix] + (FB.scale[ix] - FA.scale[ix]) * e,
          FA.scale[ix + 1] + (FB.scale[ix + 1] - FA.scale[ix + 1]) * e,
          FA.scale[ix + 2] + (FB.scale[ix + 2] - FA.scale[ix + 2]) * e,
        );
        q0.set(FA.quat[iq], FA.quat[iq + 1], FA.quat[iq + 2], FA.quat[iq + 3]);
        q1.set(FB.quat[iq], FB.quat[iq + 1], FB.quat[iq + 2], FB.quat[iq + 3]);
        q0.slerp(q1, e);
      }

      // Weight of the ring formations (they orbit) and of the scattered one (they tumble).
      const ringW = a === 0 ? 0 : a === 1 ? e : 1;
      const tumbleW = a === 0 ? e : a === 1 ? 1 - e : 0;

      pos.x *= 1 + (xScale - 1) * (1 - ringW);
      if (ringW > 0) {
        const ang = orbitBase * ringW;
        const cs = Math.cos(ang);
        const sn = Math.sin(ang);
        const x = pos.x * cs - pos.y * sn;
        const y = pos.x * sn + pos.y * cs;
        pos.x = x;
        pos.y = y;
        qz.setFromAxisAngle(Z_AXIS, ang);
        q0.premultiply(qz);
      }
      if (tumbleW > 0 && !reduced) {
        qs.setFromAxisAngle(Y_AXIS, t * set.spin[i] * 0.5 * tumbleW);
        q0.multiply(qs);
      }

      // Shards rise out of the floor when the page first loads.
      const iE = smooth(clamp(intro * 1.5 - set.introDelay[i] * 0.5));
      const grow = 0.0001 + iE;
      pos.y += Math.sin(t * 0.55 + set.phase[i]) * 0.1 * (a === 0 && u < 0.2 ? 0.35 : 1) - (1 - iE) * 2.4;
      scale.multiplyScalar(grow);

      mat.compose(pos, q0, scale);
      m.setMatrixAt(i, mat);
    }
    m.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, set.count]} frustumCulled={false}>
      <meshStandardMaterial color="#ffffff" metalness={0.6} roughness={0.28} envMapIntensity={1.3} flatShading />
    </instancedMesh>
  );
}

/**
 * The central Arc mark: a faceted arch of dark glass-metal. Inside it, a glowing curve (the discount
 * curve) with one point travelling along it, the settlement. Decorative: it carries no data.
 */
function ArcMark() {
  const group = useRef<THREE.Group>(null!);
  const dot = useRef<THREE.Mesh>(null!);
  const geometry = useMemo(() => archMarkGeometry(), []);

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    const t = sceneState.reducedMotion ? 1.2 : clock.elapsedTime;
    const e = smooth(clamp(sceneState.mark));
    const big = smooth(clamp(sceneState.p - 2));
    g.visible = e > 0.002;
    g.scale.setScalar(Math.max(0.0001, e * (1.95 + big * 0.75)));
    g.rotation.y = Math.sin(t * 0.32) * 0.62 + sceneState.pointer.x * 0.4;
    g.rotation.x = Math.sin(t * 0.27) * 0.05 - sceneState.pointer.y * 0.16;
    g.position.y = Math.sin(t * 0.6) * 0.08;
    if (dot.current) {
      // Ease along the inner curve, pause, repeat.
      const k = (t * 0.28) % 1.35;
      const u = clamp(k);
      const a = Math.PI - smooth(u) * Math.PI;
      dot.current.position.set(Math.cos(a) * 0.4, Math.sin(a) * 0.4 - 0.02, 0);
      const s = 0.05 + (1 - Math.abs(u - 0.5) * 2) * 0.025;
      dot.current.scale.setScalar(s / 0.07);
    }
  });

  return (
    <group ref={group} visible={false}>
      <mesh geometry={geometry}>
        <meshStandardMaterial color="#4A6CA6" metalness={0.95} roughness={0.22} envMapIntensity={2.4} flatShading />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <torusGeometry args={[0.4, 0.022, 8, 64, Math.PI]} />
        <meshBasicMaterial color="#A7D9FA" toneMapped={false} />
      </mesh>
      <mesh ref={dot}>
        <sphereGeometry args={[0.07, 16, 16]} />
        <meshBasicMaterial color="#F2F9FE" toneMapped={false} />
      </mesh>
    </group>
  );
}

function PointerLight() {
  const ref = useRef<THREE.PointLight>(null!);
  useFrame(() => {
    const p = sceneState.pointer;
    if (!ref.current) return;
    ref.current.position.set(p.x * 7.5, p.y * 4.2, 4.2);
    const on = p.active && !sceneState.reducedMotion;
    ref.current.intensity = on ? 38 * (1 - 0.85 * clamp(sceneState.mark)) : 0;
  });
  return <pointLight ref={ref} color="#CBE8FB" distance={9} decay={1.7} />;
}

function CameraRig() {
  useFrame(({ camera, scene, size }) => {
    const aspect = size.width / size.height;
    sceneState.aspect = aspect;
    // Pull the camera back on portrait screens so the ring and the mark still fit.
    const k = Math.max(1, Math.pow(1.6 / aspect, 0.6));
    camera.position.z += (11 * k - camera.position.z) * 0.12;
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.near = 10 * k;
      scene.fog.far = 27 * k;
    }
    const p = sceneState.pointer;
    p.x += (p.tx - p.x) * 0.06;
    p.y += (p.ty - p.y) * 0.06;
    camera.position.x += (p.x * 0.9 - camera.position.x) * 0.08;
    camera.position.y += (p.y * 0.55 - camera.position.y) * 0.08;
    camera.lookAt(0, 0, 0);
  });
  return null;
}

function Scene({ density, quality, post }: { density: number; quality: number; post: boolean }) {
  const sets = useMemo(() => {
    const n = (v: number) => Math.round(v * density);
    return {
      crystalA: { set: buildShardSet("crystal", n(230), 11), geometry: crystalGeometry(5, 3) },
      crystalB: { set: buildShardSet("crystal", n(230), 23), geometry: crystalGeometry(6, 8) },
      wedge: { set: buildShardSet("wedge", n(270), 37), geometry: wedgeGeometry() },
    };
  }, [density]);

  return (
    <>
      <color attach="background" args={["#0A1428"]} />
      <fog attach="fog" args={["#0A1428", 10, 27]} />
      <ambientLight intensity={0.22} color="#B8C7DD" />
      <directionalLight position={[6, 8, 6]} intensity={2.2} color="#CBE8FB" />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={3} color="#CBE8FB" position={[5, 5, 4]} scale={[7, 3, 1]} />
        <Lightformer form="rect" intensity={1.1} color="#9C6AAA" position={[-6, 1, 3]} scale={[3, 8, 1]} />
        <Lightformer form="ring" intensity={2} color="#7FC4F2" position={[0, 0, -6]} scale={9} />
        <Lightformer form="rect" intensity={2.2} color="#A7D9FA" position={[-5, 4, 2]} scale={[2, 6, 1]} />
        <Lightformer form="rect" intensity={2.2} color="#CBE8FB" position={[6, -2, 2]} scale={[2, 6, 1]} />
        <Lightformer form="rect" intensity={1.5} color="#ffffff" position={[0, -6, 2]} scale={[10, 1.5, 1]} />
      </Environment>
      <ShardField {...sets.crystalA} />
      <ShardField {...sets.crystalB} />
      <ShardField {...sets.wedge} />
      <ArcMark />
      <PointerLight />
      <CameraRig />
      {post && (
        // Measured on an Intel UHD (uncapped): MSAA halved the frame rate and half-float buffers cost another ~60%,
        // so the composer uses 8-bit buffers, no MSAA, and SMAA only at the top quality tier.
        <EffectComposer multisampling={0} frameBufferType={THREE.UnsignedByteType}>
          <Bloom
            intensity={0.6}
            luminanceThreshold={0.8}
            luminanceSmoothing={0.25}
            mipmapBlur
            levels={quality >= 2 ? 5 : quality === 1 ? 4 : 3}
            resolutionScale={quality >= 2 ? 0.5 : quality === 1 ? 0.4 : 0.3}
          />
          {quality >= 2 ? <SMAA /> : <></>}
          {quality >= 1 ? <Vignette eskil={false} offset={0.28} darkness={0.8} /> : <></>}
        </EffectComposer>
      )}
    </>
  );
}

/**
 * quality 2 = full, 1 = lower resolution, 0 = lowest. PerformanceMonitor steps it down when the frame rate
 * drops and back up when it recovers, so slow machines stay smooth and fast ones keep full quality.
 */
export default function ShardScene() {
  const density = useMemo(() => (typeof window !== "undefined" && window.innerWidth < 768 ? 0.5 : 1), []);
  // ?q=0|1|2 pins the quality (for testing); otherwise PerformanceMonitor adapts it.
  const pinned = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("q") : null;
  const noPost = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("post") === "0";
  const [adaptive, setQuality] = useState(2);
  const quality = pinned !== null ? Number(pinned) : adaptive;
  const dpr = quality >= 2 ? 1.5 : quality === 1 ? 1.15 : 0.85;
  return (
    <Canvas
      camera={{ fov: 38, position: [0, 0, 11], near: 0.1, far: 60 }}
      dpr={Math.min(dpr, typeof window !== "undefined" ? window.devicePixelRatio : 1)}
      gl={{ antialias: false, powerPreference: "high-performance", stencil: false }}
      aria-hidden
    >
      <PerformanceMonitor
        ms={250}
        iterations={6}
        bounds={() => [40, 58]}
        onDecline={() => setQuality((q) => Math.max(0, q - 1))}
        onIncline={() => setQuality((q) => Math.min(2, q + 1))}
      />
      <Scene density={density} quality={quality} post={!noPost} />
    </Canvas>
  );
}
