/**
 * The core vision pipeline on a decoded image Mat (§2). JS-thread, ORT + fast-opencv (D9).
 *   detectFace  -> YuNet + decode
 *   embedFace   -> aligned MobileFaceNet embedding (L2-normalized)
 *   passiveLiveness -> MiniFASNet [real,print,replay]
 * Slice 1 wires detect -> embed -> match (enroll/verify). Liveness is exposed for Slice 2.
 */

import { DataTypes, type Mat, ObjectType, OpenCV, RotateFlags } from 'react-native-fast-opencv';
import * as ort from 'onnxruntime-react-native';

import { getGallery } from './gallery';
import { l2normalize, matchAgainstGallery } from './matching';
import type { Sessions } from './ort';
import { buildLivenessInput, buildRecognitionInput, buildYunetInput } from './preprocess';
import { LIVENESS, MATCHING, RECOGNITION } from './recipes';
import type { Detection, Embedding, FaceBox, Landmarks5, LivenessResult } from './types';
import { YUNET_INPUT_SIZE, decodeYunet, selectPrimaryFace } from './yunet';

const f32 = (data: Float32Array, dims: number[]): ort.Tensor => new ort.Tensor('float32', data, dims);

function softmax3(a: number, b: number, c: number): [number, number, number] {
  const m = Math.max(a, b, c);
  const ea = Math.exp(a - m);
  const eb = Math.exp(b - m);
  const ec = Math.exp(c - m);
  const s = ea + eb + ec;
  return [ea / s, eb / s, ec / s];
}

/** Detect the primary face in a (BGR) Mat of the given pixel dimensions. */
export async function detectFace(
  sessions: Sessions,
  mat: Mat,
  width: number,
  height: number,
): Promise<Detection | null> {
  const input = buildYunetInput(mat, width, height);
  const inName = sessions.yunet.inputNames[0];
  if (inName === undefined) throw new Error('yunet: no input name');
  const res = await sessions.yunet.run({ [inName]: f32(input, [1, 3, YUNET_INPUT_SIZE, YUNET_INPUT_SIZE]) });
  const outputs: Record<string, Float32Array> = {};
  for (const name of sessions.yunet.outputNames) outputs[name] = res[name]?.data as Float32Array;
  const dets = decodeYunet(outputs, { frameWidth: width, frameHeight: height });
  return selectPrimaryFace(dets);
}

/** Aligned 512-d L2-normalized embedding for a detected face. */
export async function embedFace(sessions: Sessions, mat: Mat, landmarks: Landmarks5): Promise<Embedding> {
  const input = buildRecognitionInput(mat, landmarks);
  const inName = sessions.recognition.inputNames[0];
  const outName = sessions.recognition.outputNames[0];
  if (inName === undefined || outName === undefined) throw new Error('recognition: missing IO name');
  const res = await sessions.recognition.run({ [inName]: f32(input, [1, 3, RECOGNITION.inputSize, RECOGNITION.inputSize]) });
  const raw = res[outName]?.data as Float32Array;
  return l2normalize(new Float32Array(raw));
}

/** Passive liveness score = 1 - (p_print + p_replay) (§4.2). */
export async function passiveLiveness(sessions: Sessions, mat: Mat, box: FaceBox): Promise<LivenessResult> {
  const input = buildLivenessInput(mat, box);
  const inName = sessions.liveness.inputNames[0];
  const outName = sessions.liveness.outputNames[0];
  if (inName === undefined || outName === undefined) throw new Error('liveness: missing IO name');
  const res = await sessions.liveness.run({ [inName]: f32(input, [1, 3, LIVENESS.inputSize, LIVENESS.inputSize]) });
  const logits = res[outName]?.data as Float32Array;
  const probs = softmax3(logits[0]!, logits[1]!, logits[2]!);
  return { score: 1 - (probs[1] + probs[2]), probs };
}

export interface EnrollOutcome {
  readonly ok: boolean;
  readonly reason?: string;
  readonly detection?: Detection;
  readonly embedding?: Embedding;
}

interface OrientedDetection {
  readonly mat: Mat;
  readonly detection: Detection;
  readonly orientation: string;
}

const ROTATIONS: ReadonlyArray<{ code: RotateFlags; label: string; swaps: boolean }> = [
  { code: RotateFlags.ROTATE_90_CLOCKWISE, label: '90cw', swaps: true },
  { code: RotateFlags.ROTATE_90_COUNTERCLOCKWISE, label: '90ccw', swaps: true },
  { code: RotateFlags.ROTATE_180, label: '180', swaps: false },
];

/**
 * iOS photos decode without EXIF orientation, so a portrait capture arrives landscape and
 * YuNet (upright-trained) sees no face. Try the image as-is, then 90cw/90ccw/180, and keep the
 * first orientation that detects a face. The winning Mat is reused for embed/liveness.
 */
async function detectOriented(
  sessions: Sessions,
  mat: Mat,
  width: number,
  height: number,
): Promise<OrientedDetection | null> {
  const asIs = await detectFace(sessions, mat, width, height);
  if (asIs) return { mat, detection: asIs, orientation: 'as-is' };
  for (const r of ROTATIONS) {
    const rot = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC3);
    OpenCV.invoke('rotate', mat, rot, r.code);
    const w = r.swaps ? height : width;
    const h = r.swaps ? width : height;
    const det = await detectFace(sessions, rot, w, h);
    if (det) {
      // eslint-disable-next-line no-console
      console.log(`[FaceAuth] detect orientation=${r.label} score=${det.score.toFixed(2)}`);
      return { mat: rot, detection: det, orientation: r.label };
    }
  }
  return null;
}

/** Enroll: detect + embed a single capture. Caller adds the embedding to the gallery. */
export async function enrollFromMat(
  sessions: Sessions,
  mat: Mat,
  width: number,
  height: number,
): Promise<EnrollOutcome> {
  try {
    const o = await detectOriented(sessions, mat, width, height);
    if (!o) return { ok: false, reason: 'no face detected' };
    const embedding = await embedFace(sessions, o.mat, o.detection.landmarks);
    return { ok: true, detection: o.detection, embedding };
  } finally {
    OpenCV.clearBuffers();
  }
}

export interface VerifyOutcome {
  readonly ok: boolean;
  readonly reason?: string;
  readonly matched: boolean;
  readonly personId: string | null;
  readonly confidence: number;
  readonly detection?: Detection;
  readonly latencyMs: number;
}

/** Verify (Slice 1): detect -> embed -> cosine match against the local gallery. */
export async function verifyFromMat(
  sessions: Sessions,
  mat: Mat,
  width: number,
  height: number,
  tauMatch: number = MATCHING.tauMatch,
): Promise<VerifyOutcome> {
  const t0 = Date.now();
  try {
    const o = await detectOriented(sessions, mat, width, height);
    if (!o) {
      return { ok: false, reason: 'no face detected', matched: false, personId: null, confidence: 0, latencyMs: Date.now() - t0 };
    }
    const embedding = await embedFace(sessions, o.mat, o.detection.landmarks);
    const match = matchAgainstGallery(embedding, getGallery(), tauMatch);
    return {
      ok: true,
      matched: match.matched,
      personId: match.personId,
      confidence: match.confidence,
      detection: o.detection,
      latencyMs: Date.now() - t0,
    };
  } finally {
    OpenCV.clearBuffers();
  }
}
