import {spring} from 'remotion';

export const ORB_SIZE = 260;
export const OFFSET_X = 700;
export const OFFSET_Y = 380;

// Camera follows ORB at this fraction (0 = no follow, 1 = ORB anchored at center).
export const CAMERA_FOLLOW = 0.32;

interface Keyframe {
  at: number;
  x: number;
  y: number;
  scale: number;
  // Bezier control point offset from midpoint. Without arc → straight line.
  arc?: {x: number; y: number};
}

// Each motion event = one Bezier-curved spring transition between adjacent keyframes.
export const KEYFRAMES: Keyframe[] = [
  {at: 0,    x: 0,    y: 0,    scale: 0.04},
  {at: 120,  x: 0,    y: 0,    scale: 1},
  {at: 180,  x: 0.7,  y: -0.5, scale: 0.4,  arc: {x: -0.18, y: -0.3}},  // lob up-left into top-right
  {at: 840,  x: 0.7,  y: -0.5, scale: 0.4},
  {at: 900,  x: -0.7, y: 0.55, scale: 0.32, arc: {x: 0,     y: 0.55}},  // big U-sweep through bottom
  {at: 1140, x: -0.7, y: 0.55, scale: 0.32},
  {at: 1180, x: 0.7,  y: 0.5,  scale: 0.4,  arc: {x: 0,     y: 0.25}},  // dip across bottom
  {at: 1380, x: 0.7,  y: 0.5,  scale: 0.32},
  {at: 1440, x: 0,    y: 0,    scale: 0.85, arc: {x: -0.28, y: -0.12}}, // swoop up-left into center
  {at: 1500, x: 0,    y: 0,    scale: 0.95},
  {at: 1560, x: 0,    y: -0.4, scale: 0.55, arc: {x: 0.2,   y: -0.1}},  // rise with right-side swirl
  {at: 1740, x: 0,    y: -0.4, scale: 0.7},
  {at: 1800, x: 0,    y: -0.4, scale: 0.85},
];

export const SPRING_CONFIG = {damping: 12, stiffness: 110, mass: 0.85};

function findSegment(frame: number): number {
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    if (frame < KEYFRAMES[i + 1].at) return i;
  }
  return KEYFRAMES.length - 2;
}

function bezier2(t: number, p0: number, p1: number, p2: number): number {
  const u = 1 - t;
  return u * u * p0 + 2 * u * t * p1 + t * t * p2;
}

export interface OrbState {
  x: number;     // normalized -1..1
  y: number;
  scale: number;
  pxX: number;   // pixel offset from screen center
  pxY: number;
}

export function getOrbState(frame: number, fps: number): OrbState {
  const segIdx = findSegment(frame);
  const start = KEYFRAMES[segIdx];
  const end = KEYFRAMES[segIdx + 1];

  // Spring drives 0→1 progress within the segment, with modest overshoot.
  const t = spring({
    frame: Math.max(0, frame - start.at),
    fps,
    config: SPRING_CONFIG,
    durationInFrames: end.at - start.at,
  });

  // Quadratic Bezier through (start, midpoint+arc, end). Without arc it collapses to linear.
  const arc = end.arc ?? {x: 0, y: 0};
  const ctrlX = (start.x + end.x) / 2 + arc.x;
  const ctrlY = (start.y + end.y) / 2 + arc.y;

  const x = bezier2(t, start.x, ctrlX, end.x);
  const y = bezier2(t, start.y, ctrlY, end.y);
  const scale = start.scale + (end.scale - start.scale) * t;

  return {
    x,
    y,
    scale,
    pxX: x * OFFSET_X,
    pxY: y * OFFSET_Y,
  };
}
