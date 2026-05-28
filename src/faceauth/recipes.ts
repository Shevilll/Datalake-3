/**
 * EXACT preprocessing recipes (CLAUDE.md §4) — the TS mirror of harness/verify_models.py.
 * These constants are load-bearing: a wrong crop margin, color order, or normalization
 * silently destroys accuracy with no error. This file is the single source of truth for
 * the native/worklet pipeline; if it disagrees with verify_models.py, ONE of them is wrong.
 */

/** Detection gates (§4.1) — tune on real data. */
export const DETECTION = {
  scoreThreshold: 0.85,
  nmsThreshold: 0.3,
  /** min face-box height (px, in source frame) to accept. */
  minBoxPx: 80,
  topK: 50,
} as const;
// NOTE: YuNet's ONNX input is a FIXED 640x640 (ORT enforces it) — see YUNET_INPUT_SIZE in
// yunet.ts. The frame is always stretched to 640x640, so there is no configurable detect size.

/** Passive liveness — MiniFASNet-V2 (§4.2). BGR, 2.7x crop, 80x80, /255, NCHW. */
export const LIVENESS = {
  inputSize: 80,
  /** expand the detector bbox by this factor about its center (the upstream 2.7_80x80 recipe). */
  cropScale: 2.7,
  colorOrder: 'BGR',
  /** normalize: pixel / 255 -> [0,1]. */
  scale: 1 / 255,
  /** default pass threshold; tune on outdoor data (§7). */
  tauLive: 0.7,
} as const;

/** Recognition — MobileFaceNet/ArcFace (§4.3). RGB, 5-pt aligned 112x112, (x-127.5)/128, NCHW, L2-norm. */
export const RECOGNITION = {
  inputSize: 112,
  colorOrder: 'RGB',
  /** normalize: (pixel - mean) / std  ->  ~[-1, 1]. */
  mean: 127.5,
  std: 128.0,
  embeddingDim: 512,
} as const;

/** Matching (§4.4) — cosine on L2-normalized embeddings; max over a person's enrollments. */
export const MATCHING = {
  /** starting point for cosine on ArcFace-style embeddings; tune on the gallery (§7). */
  tauMatch: 0.4,
} as const;

/**
 * ArcFace canonical 5-point reference landmarks for a 112x112 aligned crop,
 * in (rightEye, leftEye, nose, rightMouth, leftMouth) order. Load-bearing for alignment.
 */
export const ARCFACE_REF_LANDMARKS: readonly (readonly [number, number])[] = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [56.0252, 71.7366],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
] as const;
