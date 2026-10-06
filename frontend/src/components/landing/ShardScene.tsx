"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer, PerformanceMonitor } from "@react-three/drei";
import { Bloom, EffectComposer, SMAA, Vignette } from "@react-three/postprocessing";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { sceneState } from "./scene-store";
import { THEMES, useThemeId } from "@/lib/themes";
import { archMarkGeometry, buildShardSet, crystalGeometry, mulberry32, rampColor, wedgeGeometry, type ShardSet } from "./shards";

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

  const themeId = useThemeId();
  const th = THEMES[themeId].scene;

  // Re-colour every shard when the theme changes.
  useLayoutEffect(() => {
    const m = mesh.current;
    const stops = th.shard.map((h) => new THREE.Color(h));
    const c = new THREE.Color();
    for (let i = 0; i < set.count; i++) m.setColorAt(i, rampColor(stops, set.tone[i]!, c));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [set, th]);

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
      <meshStandardMaterial color="#ffffff" metalness={th.shardGloss.metalness} roughness={th.shardGloss.roughness} envMapIntensity={th.shardGloss.env} emissive={th.shardGloss.emissive} emissiveIntensity={th.shardGloss.emissiveIntensity} flatShading />
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
  const th = THEMES[useThemeId()].scene;

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
      dot.current.position.set(Math.cos(a) * 0.5, Math.sin(a) * 0.5 - 0.02, 0);
      const s = 0.05 + (1 - Math.abs(u - 0.5) * 2) * 0.025;
      dot.current.scale.setScalar(s / 0.07);
    }
  });

  return (
    <group ref={group} visible={false}>
      <mesh geometry={geometry}>
        <meshStandardMaterial color={th.arch.color} metalness={th.arch.metalness} roughness={th.arch.roughness} envMapIntensity={th.arch.env} emissive={th.arch.emissive} emissiveIntensity={th.arch.emissiveIntensity} flatShading />
      </mesh>
      <mesh position={[0, 0, 0]}>
        <torusGeometry args={[0.5, 0.016, 8, 96, Math.PI]} />
        <meshBasicMaterial color={th.curve} toneMapped={false} />
      </mesh>
      <mesh ref={dot}>
        <sphereGeometry args={[0.07, 16, 16]} />
        <meshBasicMaterial color={th.dot} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** A few hundred tiny motes behind the shards: depth without weight. */
function Dust({ count }: { count: number }) {
  const ref = useRef<THREE.Points>(null!);
  const dust = THEMES[useThemeId()].scene.dust;
  const geometry = useMemo(() => {
    const rand = mulberry32(77);
    const p = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      p[i * 3] = (rand() - 0.5) * 26;
      p[i * 3 + 1] = (rand() - 0.5) * 15;
      p[i * 3 + 2] = -7 + rand() * 11;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    return g;
  }, [count]);
  useFrame(({ clock }) => {
    const t = sceneState.reducedMotion ? 0 : clock.elapsedTime;
    if (!ref.current) return;
    ref.current.rotation.y = t * 0.012;
    ref.current.position.y = Math.sin(t * 0.12) * 0.25;
  });
  return (
    <points ref={ref} geometry={geometry}>
      <pointsMaterial color={dust.color} size={dust.additive ? 0.04 : 0.05} sizeAttenuation transparent opacity={dust.opacity} depthWrite={false} blending={dust.additive ? THREE.AdditiveBlending : THREE.NormalBlending} />
    </points>
  );
}

function PointerLight() {
  const ref = useRef<THREE.PointLight>(null!);
  const th = THEMES[useThemeId()].scene;
  useFrame(() => {
    const p = sceneState.pointer;
    if (!ref.current) return;
    ref.current.position.set(p.x * 7.5, p.y * 4.2, 4.2);
    const on = p.active && !sceneState.reducedMotion;
    ref.current.intensity = on ? 38 * (1 - 0.85 * clamp(sceneState.mark)) : 0;
  });
  return <pointLight ref={ref} color={th.light.pointer} distance={9} decay={1.7} />;
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
      crystalA: { set: buildShardSet("crystal", n(190), 11), geometry: crystalGeometry(5, 3) },
      crystalB: { set: buildShardSet("crystal", n(190), 23), geometry: crystalGeometry(6, 8) },
      wedge: { set: buildShardSet("wedge", n(220), 37), geometry: wedgeGeometry() },
    };
  }, [density]);

  const themeId = useThemeId();
  const th = THEMES[themeId].scene;
  const e = th.env;
  return (
    <>
      <color key={`bg-${themeId}`} attach="background" args={[th.bg]} />
      <fog key={`fog-${themeId}`} attach="fog" args={[th.bg, 10, 27]} />
      <ambientLight intensity={th.light.ambientIntensity} color={th.light.ambient} />
      <directionalLight position={[6, 8, 6]} intensity={th.light.keyIntensity} color={th.light.key} />
      {/* The environment is baked once per theme: light cards reflected in the glossy crystals. */}
      <Environment key={`env-${themeId}`} resolution={128} frames={1}>
        <Lightformer form="rect" intensity={3.2 * e.boost} color={e.key} position={[5, 5, 4]} scale={[7, 3, 1]} />
        <Lightformer form="rect" intensity={2.4 * e.boost} color={e.side} position={[-6, 1, 3]} scale={[3, 8, 1]} />
        <Lightformer form="ring" intensity={2.4 * e.boost} color={e.ring} position={[0, 0, -6]} scale={9} />
        <Lightformer form="rect" intensity={2.4 * e.boost} color={e.stripA} position={[-5, 4, 2]} scale={[2, 6, 1]} />
        <Lightformer form="rect" intensity={2.2 * e.boost} color={e.stripB} position={[6, -2, 2]} scale={[2, 6, 1]} />
        <Lightformer form="rect" intensity={1.5 * e.boost} color={e.floor} position={[0, -6, 2]} scale={[10, 1.5, 1]} />
      </Environment>
      <ShardField {...sets.crystalA} />
      <ShardField {...sets.crystalB} />
      <ShardField {...sets.wedge} />
      <Dust count={density < 1 ? 110 : 240} />
      <ArcMark />
      <PointerLight />
      <CameraRig />
      {post && (th.bloom.on || quality >= 2) && (
        // Measured on an Intel UHD (uncapped): MSAA halved the frame rate and half-float buffers cost another ~60%,
        // so the composer uses 8-bit buffers, no MSAA, and SMAA only at the top quality tier.
        <EffectComposer multisampling={0} frameBufferType={THREE.UnsignedByteType}>
          {th.bloom.on ? (
            <Bloom
              intensity={th.bloom.intensity}
              luminanceThreshold={th.bloom.threshold}
              luminanceSmoothing={0.25}
              mipmapBlur
              levels={quality >= 2 ? 5 : quality === 1 ? 4 : 3}
              resolutionScale={quality >= 2 ? 0.5 : quality === 1 ? 0.4 : 0.3}
            />
          ) : (
            <></>
          )}
          {quality >= 2 ? <SMAA /> : <></>}
          {th.vignette && quality >= 1 ? <Vignette eskil={false} offset={0.28} darkness={0.8} /> : <></>}
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
