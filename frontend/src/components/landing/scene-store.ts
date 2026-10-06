/**
 * Shared, mutable scene state. Written by the scroll driver, read every frame by the
 * three.js scene. It is deliberately not React state: scroll fires far too often for that.
 *
 * p      continuous formation index. 0 hero field, 1 scattered edge, 2 ring, 3 final ring.
 * mark   0..1 how much of the central Arc mark is visible.
 * scrollY / vh  raw scroll position and viewport height.
 */
export const sceneState = {
  p: 0,
  mark: 0,
  scrollY: 0,
  vh: 800,
  pointer: { x: 0, y: 0, tx: 0, ty: 0, active: false },
  aspect: 1.78,
  reducedMotion: false,
};

export type Keyframes = Array<[number, number]>;

/** Piecewise-linear lookup of a value at scroll position y. Keys must be sorted by y. */
export function sample(keys: Keyframes, y: number): number {
  if (keys.length === 0) return 0;
  if (y <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [y1, v1] = keys[i];
    if (y <= y1) {
      const [y0, v0] = keys[i - 1];
      const span = y1 - y0;
      return span <= 0 ? v1 : v0 + ((v1 - v0) * (y - y0)) / span;
    }
  }
  return keys[keys.length - 1][1];
}

type Tick = (state: { scrollY: number; vh: number; time: number }) => void;
const ticks = new Set<Tick>();

/** Register a per-frame callback that runs in the same rAF as the smooth-scroll driver. */
export function onTick(fn: Tick): () => void {
  ticks.add(fn);
  return () => {
    ticks.delete(fn);
  };
}

export function runTicks(time: number) {
  for (const fn of ticks) fn({ scrollY: sceneState.scrollY, vh: sceneState.vh, time });
}
