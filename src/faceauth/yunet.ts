/**
 * YuNet output decoder (§4.1) — TS port of the algorithm verified bit-exact against
 * cv2.FaceDetectorYN in harness/yunet_decode_ref.py (0.000 px error).
 *
 * The model has a FIXED 640x640 input (ORT enforces it), with one anchor per cell at
 * strides 8/16/32 → 6400/1600/400 anchors. Preprocessing for the model input is:
 * resize frame to 640x640, BGR, [0,255], NCHW (no normalization).
 *
 * decodeYunet() consumes the raw ORT output Float32Arrays and returns detections already
 * scaled back to the original frame coordinates, sorted by score, NMS-filtered, top-K.
 */

import { DETECTION } from './recipes';
import type { Detection, FaceBox, Landmarks5, Point } from './types';

export const YUNET_INPUT_SIZE = 640;
const STRIDES = [8, 16, 32] as const;

/** Raw model outputs keyed by name (cls_8, obj_8, bbox_8, kps_8, cls_16, ...). */
export type YunetOutputs = Readonly<Record<string, Float32Array>>;

interface RawDet {
  score: number;
  box: [number, number, number, number]; // x,y,w,h in 640-space
  lms: [number, number][]; // 5 points in 640-space
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function decodeStride(out: YunetOutputs, stride: number, scoreThr: number): RawDet[] {
  const cls = out[`cls_${stride}`];
  const obj = out[`obj_${stride}`];
  const bbox = out[`bbox_${stride}`];
  const kps = out[`kps_${stride}`];
  if (!cls || !obj || !bbox || !kps) throw new Error(`decodeYunet: missing outputs for stride ${stride}`);

  const cols = YUNET_INPUT_SIZE / stride;
  const rows = YUNET_INPUT_SIZE / stride;
  const dets: RawDet[] = [];

  for (let idx = 0; idx < rows * cols; idx++) {
    const score = Math.sqrt(clamp01(cls[idx]!) * clamp01(obj[idx]!));
    if (score < scoreThr) continue;
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const b = idx * 4;
    const cx = (c + bbox[b]!) * stride;
    const cy = (r + bbox[b + 1]!) * stride;
    const w = Math.exp(bbox[b + 2]!) * stride;
    const h = Math.exp(bbox[b + 3]!) * stride;
    const k = idx * 10;
    const lms: [number, number][] = [];
    for (let j = 0; j < 5; j++) {
      lms.push([(c + kps[k + 2 * j]!) * stride, (r + kps[k + 2 * j + 1]!) * stride]);
    }
    dets.push({ score, box: [cx - w / 2, cy - h / 2, w, h], lms });
  }
  return dets;
}

function iou(a: RawDet['box'], b: RawDet['box']): number {
  const [ax, ay, aw, ah] = a;
  const [bx, by, bw, bh] = b;
  const ix = Math.max(ax, bx);
  const iy = Math.max(ay, by);
  const axx = Math.min(ax + aw, bx + bw);
  const ayy = Math.min(ay + ah, by + bh);
  const inter = Math.max(0, axx - ix) * Math.max(0, ayy - iy);
  const union = aw * ah + bw * bh - inter;
  return union <= 0 ? 0 : inter / union;
}

function nms(dets: RawDet[], iouThr: number, topK: number): RawDet[] {
  const sorted = [...dets].sort((p, q) => q.score - p.score).slice(0, Math.max(topK * 4, topK));
  const keep: RawDet[] = [];
  for (const d of sorted) {
    if (keep.length >= topK) break;
    if (keep.every((k) => iou(k.box, d.box) <= iouThr)) keep.push(d);
  }
  return keep;
}

function toLandmarks5(lms: [number, number][], sx: number, sy: number): Landmarks5 {
  const p = (i: number): Point => ({ x: lms[i]![0] * sx, y: lms[i]![1] * sy });
  return { rightEye: p(0), leftEye: p(1), nose: p(2), rightMouth: p(3), leftMouth: p(4) };
}

export interface DecodeOptions {
  /** original frame width (to scale 640-space coords back). */
  readonly frameWidth: number;
  /** original frame height. */
  readonly frameHeight: number;
  readonly scoreThreshold?: number;
  readonly nmsThreshold?: number;
  readonly topK?: number;
}

/** Decode YuNet outputs → detections in original frame coordinates. */
export function decodeYunet(out: YunetOutputs, opts: DecodeOptions): Detection[] {
  const scoreThr = opts.scoreThreshold ?? DETECTION.scoreThreshold;
  const nmsThr = opts.nmsThreshold ?? DETECTION.nmsThreshold;
  const topK = opts.topK ?? DETECTION.topK;

  const raw: RawDet[] = [];
  for (const s of STRIDES) raw.push(...decodeStride(out, s, scoreThr));
  const kept = nms(raw, nmsThr, topK);

  const sx = opts.frameWidth / YUNET_INPUT_SIZE;
  const sy = opts.frameHeight / YUNET_INPUT_SIZE;
  return kept.map((d): Detection => {
    const [x, y, w, h] = d.box;
    const box: FaceBox = { x: x * sx, y: y * sy, width: w * sx, height: h * sy };
    return { box, landmarks: toLandmarks5(d.lms, sx, sy), score: d.score };
  });
}

/** Pick the largest sufficiently-confident, large-enough face, or null (detection gate, §4.1). */
export function selectPrimaryFace(dets: readonly Detection[], minBoxPx: number = DETECTION.minBoxPx): Detection | null {
  let best: Detection | null = null;
  for (const d of dets) {
    if (d.box.height < minBoxPx) continue;
    if (!best || d.box.width * d.box.height > best.box.width * best.box.height) best = d;
  }
  return best;
}
