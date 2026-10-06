import * as THREE from "three";

/**
 * Shard geometry and the formations the shards move between as the page scrolls.
 *
 * The shards are fragments of the brand motif: faceted crystals and annular wedges
 * (pieces of an arc). The hero field, the scattered edge, the ring and the final ring are
 * all precomputed here; the scene only interpolates between them.
 */

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Gem-like crystal: bottom apex, two offset rings forming an antiprism band, top apex. */
export function crystalGeometry(sides: number, seed: number): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const r0: THREE.Vector3[] = [];
  const r1: THREE.Vector3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = ((i + (rand() - 0.5) * 0.25) / sides) * Math.PI * 2;
    const radius = 0.34 * (0.85 + rand() * 0.3);
    r0.push(new THREE.Vector3(Math.cos(a) * radius, -0.1, Math.sin(a) * radius));
    const b = ((i + 0.5 + (rand() - 0.5) * 0.25) / sides) * Math.PI * 2;
    const radius1 = 0.22 * (0.85 + rand() * 0.3);
    r1.push(new THREE.Vector3(Math.cos(b) * radius1, 0.85, Math.sin(b) * radius1));
  }
  const top = new THREE.Vector3(0, 1.6, 0);
  const bottom = new THREE.Vector3(0, -0.75, 0);
  const tris: THREE.Vector3[][] = [];
  for (let i = 0; i < sides; i++) {
    const n = (i + 1) % sides;
    const p = (i + sides - 1) % sides;
    tris.push([bottom, r0[n], r0[i]]);
    tris.push([r0[i], r0[n], r1[i]]);
    tris.push([r0[i], r1[i], r1[p]]);
    tris.push([top, r1[p], r1[i]]);
  }
  const centre = new THREE.Vector3(0, 0.3, 0);
  const pos: number[] = [];
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const mid = new THREE.Vector3();
  for (const [a, b, c] of tris) {
    ab.subVectors(b, a);
    ac.subVectors(c, a);
    nrm.crossVectors(ab, ac);
    mid.copy(a).add(b).add(c).divideScalar(3).sub(centre);
    const [v1, v2] = nrm.dot(mid) < 0 ? [c, b] : [b, c];
    pos.push(a.x, a.y, a.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** A fragment of an arc: an annular sector, extruded and bevelled. */
export function wedgeGeometry(angle = Math.PI * 0.26, inner = 0.74, outer = 1.0, depth = 0.1): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const half = angle / 2;
  s.absarc(0, 0, outer, -half, half, false);
  s.absarc(0, 0, inner, half, -half, true);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.025,
    bevelSize: 0.022,
    bevelSegments: 2,
    curveSegments: 5,
  });
  g.center();
  // Lay the arc fragment so its tangent runs along local Y, like the crystals.
  g.rotateZ(Math.PI / 2);
  return g;
}

export interface Formation {
  pos: Float32Array;
  quat: Float32Array;
  scale: Float32Array;
}

export interface ShardSet {
  count: number;
  formations: Formation[];
  delay: Float32Array;
  phase: Float32Array;
  spin: Float32Array;
  introDelay: Float32Array;
  /** Position on the theme's colour ramp, 0 (darkest) to 1 (glint). The theme decides the actual colour. */
  tone: Float32Array;
}

/** Linear lookup on a colour ramp: t in 0..1 over the stops, dark to light. */
export function rampColor(stops: readonly THREE.Color[], t: number, out: THREE.Color): THREE.Color {
  const x = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(x);
  return out.copy(stops[i]!).lerp(stops[i + 1]!, x - i);
}

function gauss(rand: () => number) {
  return (rand() + rand() + rand() - 1.5) / 1.5;
}

function writeQuat(out: Float32Array, i: number, e: THREE.Euler, q: THREE.Quaternion) {
  q.setFromEuler(e);
  out[i * 4] = q.x;
  out[i * 4 + 1] = q.y;
  out[i * 4 + 2] = q.z;
  out[i * 4 + 3] = q.w;
}

export function buildShardSet(kind: "crystal" | "wedge", count: number, seed: number): ShardSet {
  const rand = mulberry32(seed);
  const mk = (): Formation => ({
    pos: new Float32Array(count * 3),
    quat: new Float32Array(count * 4),
    scale: new Float32Array(count * 3),
  });
  const F = [mk(), mk(), mk(), mk()];
  const delay = new Float32Array(count);
  const phase = new Float32Array(count);
  const spin = new Float32Array(count);
  const introDelay = new Float32Array(count);
  const tone = new Float32Array(count);
  const e = new THREE.Euler();
  const q = new THREE.Quaternion();

  for (let i = 0; i < count; i++) {
    delay[i] = rand();
    phase[i] = rand() * Math.PI * 2;
    spin[i] = (rand() - 0.5) * 2;
    introDelay[i] = rand();

    const pick = rand();
    tone[i] = pick < 0.34 ? rand() * 0.25 : pick < 0.78 ? 0.25 + rand() * 0.3 : pick < 0.96 ? 0.55 + rand() * 0.3 : 0.93 + rand() * 0.07;

    // ---- F0: hero field. Upright shards rising from the bottom edge. ----
    {
      const z = -9 + Math.pow(rand(), 1.25) * 11.5;
      const persp = (11 - z) / 11;
      const x = (rand() - 0.5) * 2 * 10.5 * persp;
      const h = Math.pow(rand(), 1.8);
      const sy = kind === "crystal" ? 0.55 + h * 1.15 : 0.6 + h * 0.6;
      const sx = kind === "crystal" ? 0.3 + rand() * 0.3 : 0.5 + rand() * 0.4;
      const y = (-3.45 + gauss(rand) * 0.4) * persp;
      F[0].pos.set([x, y, z], i * 3);
      F[0].scale.set([sx, sy, sx], i * 3);
      e.set((rand() - 0.5) * 0.45, rand() * Math.PI * 2, (rand() - 0.5) * 0.45, "YXZ");
      if (kind === "wedge") e.set((rand() - 0.5) * 0.9, rand() * Math.PI * 2, (rand() - 0.5) * 0.9, "YXZ");
      writeQuat(F[0].quat, i, e, q);
    }

    // ---- F1: scattered around the edge, centre kept clear for text. ----
    {
      const th = rand() * Math.PI * 2;
      const f = 0.8 + Math.pow(rand(), 0.7) * 0.65;
      const z = -4.5 + rand() * 7;
      const persp = (11 - z) / 11;
      F[1].pos.set([Math.cos(th) * 8.4 * f * persp, Math.sin(th) * 4.7 * f * persp, z], i * 3);
      const keep = rand() < 0.68 ? 1 : 0.0001; // a third of the shards fold away so text stays readable
      const s = (0.22 + Math.pow(rand(), 2) * 0.8) * keep;
      F[1].scale.set(kind === "crystal" ? [s * 0.85, s * 1.25, s * 0.85] : [s, s, s], i * 3);
      e.set(rand() * 6.28, rand() * 6.28, rand() * 6.28);
      writeQuat(F[1].quat, i, e, q);
    }

    // ---- F2 / F3: a ring facing the camera. ----
    for (const [fi, radius, thick, zs, smin, srange] of [
      [2, 4.4, 0.2, 1.0, 0.22, 0.38],
      [3, 5.3, 0.34, 1.6, 0.26, 0.5],
    ] as const) {
      const th = (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.06;
      const r = radius + gauss(rand) * thick;
      const z = (rand() - 0.5) * zs;
      F[fi].pos.set([Math.cos(th) * r, Math.sin(th) * r, z], i * 3);
      const s = smin + Math.pow(rand(), 2) * srange;
      F[fi].scale.set(kind === "crystal" ? [s * 0.85, s * 1.35, s * 0.85] : [s, s, s], i * 3);
      e.set((rand() - 0.5) * 0.5, (rand() - 0.5) * 0.7, th + (rand() - 0.5) * 0.22, "XYZ");
      writeQuat(F[fi].quat, i, e, q);
    }
  }

  return { count, formations: F, delay, phase, spin, introDelay, tone };
}

/** An arch (rainbow) with short legs: the central Arc mark, extruded and bevelled so it catches light in facets. */
export function archMarkGeometry(): THREE.BufferGeometry {
  const outer = 1.0;
  const inner = 0.7;
  const leg = 0.5;
  const s = new THREE.Shape();
  s.moveTo(-outer, -leg);
  s.lineTo(-outer, 0);
  s.absarc(0, 0, outer, Math.PI, 0, true);
  s.lineTo(outer, -leg);
  s.lineTo(inner, -leg);
  s.lineTo(inner, 0);
  s.absarc(0, 0, inner, 0, Math.PI, false);
  s.lineTo(-inner, -leg);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 0.34,
    bevelEnabled: true,
    bevelThickness: 0.05,
    bevelSize: 0.03,
    bevelSegments: 3,
    curveSegments: 40,
  });
  g.center();
  return g;
}
