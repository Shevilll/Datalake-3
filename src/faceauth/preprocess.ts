/**
 * Mat -> ORT tensor preprocessing (§4). Everything is an affine warp:
 *  - YuNet:       stretch the whole image to 640x640 (BGR, [0,255], NCHW)
 *  - Liveness:    2.7x crop about the bbox center -> 80x80 (BGR, /255, NCHW)
 *  - Recognition: 5-pt similarity alignment -> 112x112, BGR->RGB, (x-127.5)/128, NCHW
 *
 * fast-opencv stores Mats in C++; callers MUST call OpenCV.clearBuffers() after consuming
 * the returned Float32Arrays (which are JS-owned copies, safe to keep after clearing).
 */

import { ColorConversionCodes, DataTypes, type Mat, ObjectType, OpenCV } from 'react-native-fast-opencv';

import { ARCFACE_REF_LANDMARKS, LIVENESS, RECOGNITION } from './recipes';
import { estimateSimilarityTransform } from './similarityTransform';
import type { FaceBox, Landmarks5 } from './types';
import { YUNET_INPUT_SIZE } from './yunet';

type NormFn = (v: number) => number;

/** Run a 2x3 affine warp into a fresh dst Mat of the given output size. */
function warp(src: Mat, m: readonly number[], outW: number, outH: number): Mat {
  const M = OpenCV.createObject(ObjectType.Mat, 2, 3, DataTypes.CV_32F, [...m]);
  const dst = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC3);
  const dsize = OpenCV.createObject(ObjectType.Size, outW, outH);
  OpenCV.invoke('warpAffine', src, dst, M, dsize);
  return dst;
}

/** Interleaved HWC uint8 Mat -> planar CHW float32 with a per-value normalization. */
function matToNCHW(mat: Mat, w: number, h: number, normalize: NormFn): Float32Array {
  const { buffer } = OpenCV.matToBuffer(mat, 'uint8'); // HWC, 3 channels, row-major
  const plane = w * h;
  const out = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    const px = i * 3;
    out[i] = normalize(buffer[px]!); // channel 0
    out[plane + i] = normalize(buffer[px + 1]!); // channel 1
    out[2 * plane + i] = normalize(buffer[px + 2]!); // channel 2
  }
  return out;
}

const identity: NormFn = (v) => v;

/** YuNet input: BGR, stretched to 640x640, no normalization, NCHW. */
export function buildYunetInput(src: Mat, srcWidth: number, srcHeight: number): Float32Array {
  const sx = YUNET_INPUT_SIZE / srcWidth;
  const sy = YUNET_INPUT_SIZE / srcHeight;
  const dst = warp(src, [sx, 0, 0, 0, sy, 0], YUNET_INPUT_SIZE, YUNET_INPUT_SIZE);
  return matToNCHW(dst, YUNET_INPUT_SIZE, YUNET_INPUT_SIZE, identity);
}

/**
 * Passive-liveness input (§4.2), faithful to Silent-Face's crop so the model isn't fed a
 * black-bordered / mis-framed face (which it reads as "replay"):
 *  - scale = min((H-1)/box_h, (W-1)/box_w, 2.7)  — clamp so the crop fits the image, no border
 *  - crop box_w*scale x box_h*scale (aspect-preserving), shifted to stay in-bounds
 *  - resize to 80x80 (aspect distortion is expected — it's how the model was trained)
 * BGR, /255, NCHW.
 */
export function buildLivenessInput(src: Mat, box: FaceBox, imgW: number, imgH: number): Float32Array {
  const scale = Math.min((imgH - 1) / box.height, (imgW - 1) / box.width, LIVENESS.cropScale);
  const newW = box.width * scale;
  const newH = box.height * scale;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  let x0 = cx - newW / 2;
  let y0 = cy - newH / 2;
  let x1 = cx + newW / 2;
  let y1 = cy + newH / 2;
  // shift the crop to keep its size while staying inside the image (no black border)
  if (x0 < 0) { x1 -= x0; x0 = 0; }
  if (y0 < 0) { y1 -= y0; y0 = 0; }
  if (x1 > imgW) { x0 -= x1 - imgW; x1 = imgW; }
  if (y1 > imgH) { y0 -= y1 - imgH; y1 = imgH; }
  x0 = Math.max(0, x0);
  y0 = Math.max(0, y0);
  const sx = LIVENESS.inputSize / (x1 - x0);
  const sy = LIVENESS.inputSize / (y1 - y0);
  const dst = warp(src, [sx, 0, -sx * x0, 0, sy, -sy * y0], LIVENESS.inputSize, LIVENESS.inputSize);
  const norm = LIVENESS.scale;
  return matToNCHW(dst, LIVENESS.inputSize, LIVENESS.inputSize, (v) => v * norm);
}

/** Recognition input: 5-pt aligned 112x112, BGR->RGB, (x-127.5)/128, NCHW (§4.3). */
export function buildRecognitionInput(src: Mat, lms: Landmarks5): Float32Array {
  const m = estimateSimilarityTransform(
    [lms.rightEye, lms.leftEye, lms.nose, lms.rightMouth, lms.leftMouth],
    ARCFACE_REF_LANDMARKS,
  );
  const aligned = warp(src, m, RECOGNITION.inputSize, RECOGNITION.inputSize);
  const rgb = OpenCV.createObject(ObjectType.Mat, 0, 0, DataTypes.CV_8UC3);
  OpenCV.invoke('cvtColor', aligned, rgb, ColorConversionCodes.COLOR_BGR2RGB);
  const { mean, std } = RECOGNITION;
  return matToNCHW(rgb, RECOGNITION.inputSize, RECOGNITION.inputSize, (v) => (v - mean) / std);
}
