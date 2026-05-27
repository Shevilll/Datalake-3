/**
 * Similarity (partial-affine) transform estimation — the ArcFace alignment step (§4.3).
 *
 * fast-opencv exposes warpAffine but NOT estimateAffinePartial2D (DECISIONS.md D9), so we
 * compute the 2x3 matrix here, then hand it to warpAffine to produce the aligned 112x112 crop.
 *
 * A similarity transform has 4 DOF (uniform scale, rotation, tx, ty):
 *     x' =  a*x - b*y + tx
 *     y' =  b*x + a*y + ty       (a = s*cosθ, b = s*sinθ)
 * With N>=2 landmark correspondences this is an overdetermined linear system in (a,b,tx,ty);
 * we solve the 4x4 normal equations by least squares. This matches cv2.estimateAffinePartial2D
 * for clean (non-outlier) points such as YuNet's 5 landmarks.
 *
 * Returns the 2x3 matrix mapping SOURCE (detected landmarks) -> DEST (reference) as a flat
 * row-major array [m00, m01, m02, m10, m11, m12] suitable for warpAffine.
 */

import type { Point } from './types';

/** Solve a 4x4 linear system Ax=b via Gaussian elimination with partial pivoting. */
function solve4x4(A: number[][], b: number[]): [number, number, number, number] {
  // Augmented matrix
  const m = A.map((row, i) => [...row, b[i] as number]);
  for (let col = 0; col < 4; col++) {
    // partial pivot
    let pivot = col;
    for (let r = col + 1; r < 4; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    }
    if (pivot !== col) {
      const tmp = m[col]!;
      m[col] = m[pivot]!;
      m[pivot] = tmp;
    }
    const diag = m[col]![col]!;
    if (Math.abs(diag) < 1e-12) throw new Error('similarityTransform: singular system');
    for (let r = 0; r < 4; r++) {
      if (r === col) continue;
      const factor = m[r]![col]! / diag;
      for (let c = col; c <= 4; c++) m[r]![c]! -= factor * m[col]![c]!;
    }
  }
  return [
    m[0]![4]! / m[0]![0]!,
    m[1]![4]! / m[1]![1]!,
    m[2]![4]! / m[2]![2]!,
    m[3]![4]! / m[3]![3]!,
  ];
}

/**
 * Estimate the similarity transform mapping `src` points onto `dst` points.
 * @returns flat 2x3 row-major matrix [m00,m01,m02,m10,m11,m12].
 */
export function estimateSimilarityTransform(
  src: readonly Point[],
  dst: readonly (readonly [number, number])[],
): [number, number, number, number, number, number] {
  if (src.length !== dst.length || src.length < 2) {
    throw new Error('estimateSimilarityTransform: need >=2 matched point pairs');
  }
  // Normal equations for parameters p = [a, b, tx, ty].
  // Each point contributes two rows:
  //   row_x = [x, -y, 1, 0]  ->  x'
  //   row_y = [y,  x, 0, 1]  ->  y'
  const AtA: number[][] = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  const Atb: number[] = [0, 0, 0, 0];

  const addRow = (r: readonly [number, number, number, number], target: number): void => {
    for (let i = 0; i < 4; i++) {
      Atb[i]! += r[i]! * target;
      for (let j = 0; j < 4; j++) AtA[i]![j]! += r[i]! * r[j]!;
    }
  };

  for (let k = 0; k < src.length; k++) {
    const { x, y } = src[k]!;
    const [xp, yp] = dst[k]!;
    addRow([x, -y, 1, 0], xp);
    addRow([y, x, 0, 1], yp);
  }

  const [a, b, tx, ty] = solve4x4(AtA, Atb);
  // M = [[a, -b, tx], [b, a, ty]]
  return [a, -b, tx, b, a, ty];
}

/** Apply a flat 2x3 transform to a point (handy for tests / landmark remapping). */
export function applyAffine(
  m: readonly [number, number, number, number, number, number],
  p: Point,
): Point {
  return {
    x: m[0] * p.x + m[1] * p.y + m[2],
    y: m[3] * p.x + m[4] * p.y + m[5],
  };
}
