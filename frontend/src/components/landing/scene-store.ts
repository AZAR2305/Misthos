/**
 * Shared, mutable state for the 3D agents. Written by the landing page, read every frame by the three.js canvases.
 * It is deliberately not React state: the pointer fires far too often for that.
 */
export const sceneState = {
  pointer: { x: 0, y: 0, tx: 0, ty: 0, active: false },
  reducedMotion: false,
};
