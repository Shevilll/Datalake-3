/**
 * Active liveness — randomized challenge-response geometry (§5.1), computed from YuNet's
 * 5 landmarks (rightEye, leftEye, nose, rightMouth, leftMouth).
 *
 * Challenge set (DECISIONS.md D3): headLeft / headRight / smile.
 * (mouthOpen and EAR-blink need lip/eyelid contours YuNet doesn't provide.)
 *
 * The differentiator (§5.2): pass liveness iff passiveScore > τ_live AND a RANDOM active
 * challenge is completed in a time window. Passive rejects flat photos; the randomized
 * active gesture defeats replay of a pre-recorded video.
 *
 * NOTE: thresholds + the yaw sign are calibrated on-device (front-camera mirroring flips
 * left/right). Defaults below are starting points — tune against real captures.
 */

import type { ActiveChallenge, Landmarks5, Point } from './types';

export type { ActiveChallenge };

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export interface FaceGeometry {
  /** inter-ocular distance (px) — the scale-normalizer. */
  readonly interocular: number;
  /** signed yaw proxy: nose offset from the eye midpoint / interocular. ~0 frontal. */
  readonly yaw: number;
  /** smile proxy: mouth-corner spread / interocular. Rises when smiling. */
  readonly smile: number;
}

export function computeGeometry(lm: Landmarks5): FaceGeometry {
  const interocular = dist(lm.rightEye, lm.leftEye) || 1e-6;
  const eyeMidX = (lm.rightEye.x + lm.leftEye.x) / 2;
  return {
    interocular,
    yaw: (lm.nose.x - eyeMidX) / interocular,
    smile: dist(lm.rightMouth, lm.leftMouth) / interocular,
  };
}

/**
 * Thresholds — TUNED on-device against real YuNet readings (not my pre-calibration guesses).
 * First live data point (2026-05-28): a real smile gave smile=0.83 (YuNet's mouth corners
 * normalized by interocular distance run lower than textbook anthropometry suggests). Frontal
 * yaw ~0.05; need a clear turn to clear the bar without false-passing a frontal face.
 */
export const ACTIVE_THRESHOLDS = {
  /** |yaw| beyond this counts as a clear head turn. Calibrated on-device: a moderate turn
   * sits around 0.2–0.4; extreme turns (>0.7) tank recognition cosine, so we keep this modest. */
  yawTurn: 0.15,
  /** smile ratio above this counts as a smile. Observed on-device range during smile attempts
   * was 0.64–0.83 (YuNet's mouth corners run tighter than textbook anthropometry). */
  smileSpread: 0.75,
} as const;

export function challengePrompt(c: ActiveChallenge): string {
  switch (c) {
    case 'headLeft':
      return 'Turn slightly LEFT';
    case 'headRight':
      return 'Turn slightly RIGHT';
    case 'smile':
      return 'Smile';
  }
}

// Calibrated on-device (2026-05-28): all 3 challenges verify reliably (cos 0.79-0.86,
// directional intent correct) once enrollment covers a mix of frontal + slight-turn poses.
// Multi-shot enrollment is the unlock — single-frontal-only enrollment tanks cos under turn.
const ALL: readonly ActiveChallenge[] = ['headLeft', 'headRight', 'smile'];

/**
 * Cryptographically-secure random int in [0, max). Challenge selection is security-relevant:
 * a predictable RNG would let an attacker pre-position a recorded gesture before the prompt,
 * defeating the anti-replay guarantee. Uses Web Crypto when present (activated on-device once
 * react-native-get-random-values is added in the next native build, see DECISIONS.md D10);
 * falls back to Math.random only if no CSPRNG is available.
 */
function secureRandomInt(max: number): number {
  const g = globalThis as { crypto?: { getRandomValues?: (a: Uint32Array) => Uint32Array } };
  const grv = g.crypto?.getRandomValues;
  if (grv) {
    const buf = new Uint32Array(1);
    grv.call(g.crypto, buf);
    return buf[0]! % max;
  }
  return Math.floor(Math.random() * max);
}

export function randomChallenge(): ActiveChallenge {
  return ALL[secureRandomInt(ALL.length)]!;
}

/**
 * A randomized SEQUENCE of n distinct-or-repeating challenges. Raises per-attempt entropy and
 * the replay bar: with 3 choices, n=2 → ~3.17 bits, blind-guess success ≈ (1/3)^2 ≈ 11%.
 */
export function randomChallengeSequence(n: number): ActiveChallenge[] {
  return Array.from({ length: Math.max(1, n) }, () => randomChallenge());
}

/**
 * Does a capture's geometry satisfy the challenge?
 * @param yawSign +1 or -1 — the on-device-calibrated direction multiplier for the front camera.
 */
export function satisfiesChallenge(
  c: ActiveChallenge,
  g: FaceGeometry,
  yawSign: 1 | -1 = 1,
  t = ACTIVE_THRESHOLDS,
): boolean {
  const yaw = g.yaw * yawSign;
  switch (c) {
    case 'headLeft':
      return yaw < -t.yawTurn;
    case 'headRight':
      return yaw > t.yawTurn;
    case 'smile':
      return g.smile > t.smileSpread;
  }
}
