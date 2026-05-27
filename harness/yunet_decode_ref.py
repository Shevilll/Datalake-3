"""
yunet_decode_ref.py — reference implementation of the YuNet output decode, verified
against OpenCV's cv2.FaceDetectorYN ground truth.

WHY: the native pipeline (DECISIONS.md D9, architecture v1) runs YuNet via
onnxruntime-react-native and decodes the multi-scale heads IN TYPESCRIPT (fast-opencv has
no FaceDetectorYN). A wrong decode silently breaks detection. We pin the algorithm here
against cv2 ground truth, then port the SAME math to src/faceauth/yunet.ts and cross-check.

YuNet decode (per OpenCV objdetect): for strides 8/16/32, one anchor per cell (r,c):
    score = sqrt(clamp(cls)*clamp(obj))
    cx=(c+bbox0)*s  cy=(r+bbox1)*s  w=exp(bbox2)*s  h=exp(bbox3)*s
    landmark_k: (c+kps[2k])*s , (r+kps[2k+1])*s
Preprocessing: BGR uint8 [0,255], NCHW, no normalization, size = (W,H) multiples of 32.
"""

from __future__ import annotations

import math
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

MODELS = Path(__file__).resolve().parent.parent / "models"
YUNET = MODELS / "yunet.onnx"
IMG = Path(__file__).resolve().parent / "samples" / "obama.jpg"
STRIDES = (8, 16, 32)


def preprocess(bgr: np.ndarray, w: int, h: int) -> np.ndarray:
    resized = cv2.resize(bgr, (w, h))
    blob = resized.astype(np.float32)  # BGR, [0,255], no normalization
    return np.transpose(blob, (2, 0, 1))[None, ...]  # NCHW


def decode(outputs: dict[str, np.ndarray], w: int, h: int, score_thr: float):
    dets = []
    for s in STRIDES:
        cls = outputs[f"cls_{s}"][0]   # (N,1)
        obj = outputs[f"obj_{s}"][0]   # (N,1)
        bbox = outputs[f"bbox_{s}"][0]  # (N,4)
        kps = outputs[f"kps_{s}"][0]   # (N,10)
        cols, rows = w // s, h // s
        for idx in range(rows * cols):
            r, c = divmod(idx, cols)
            cls_s = min(max(float(cls[idx][0]), 0.0), 1.0)
            obj_s = min(max(float(obj[idx][0]), 0.0), 1.0)
            score = math.sqrt(cls_s * obj_s)
            if score < score_thr:
                continue
            cx = (c + bbox[idx][0]) * s
            cy = (r + bbox[idx][1]) * s
            bw = math.exp(bbox[idx][2]) * s
            bh = math.exp(bbox[idx][3]) * s
            x, y = cx - bw / 2, cy - bh / 2
            lms = [((c + kps[idx][2 * k]) * s, (r + kps[idx][2 * k + 1]) * s) for k in range(5)]
            dets.append((score, [x, y, bw, bh], lms))
    return dets


def nms(dets, iou_thr: float):
    dets = sorted(dets, key=lambda d: d[0], reverse=True)
    keep = []
    while dets:
        best = dets.pop(0)
        keep.append(best)
        bx, by, bw, bh = best[1]
        rem = []
        for d in dets:
            x, y, w_, h_ = d[1]
            ix, iy = max(bx, x), max(by, y)
            ax, ay = min(bx + bw, x + w_), min(by + bh, y + h_)
            inter = max(0, ax - ix) * max(0, ay - iy)
            union = bw * bh + w_ * h_ - inter
            if union <= 0 or inter / union <= iou_thr:
                rem.append(d)
        dets = rem
    return keep


def main() -> int:
    bgr = cv2.imread(str(IMG))
    W, H = 640, 640  # yunet.onnx has a FIXED 640x640 input (ORT enforces it; cv2 reshapes internally)

    # --- ground truth: cv2.FaceDetectorYN at the same size ---
    det = cv2.FaceDetectorYN.create(str(YUNET), "", (W, H), 0.85, 0.3, 50)
    gt_img = cv2.resize(bgr, (W, H))
    det.setInputSize((W, H))
    _, gt = det.detect(gt_img)
    assert gt is not None and len(gt) > 0, "cv2 ground truth found no face"
    gt = sorted(gt, key=lambda f: f[2] * f[3], reverse=True)[0]
    gt_box = gt[0:4]
    gt_lms = gt[4:14].reshape(5, 2)
    gt_score = gt[14]

    # --- our manual decode ---
    sess = ort.InferenceSession(str(YUNET), providers=["CPUExecutionProvider"])
    blob = preprocess(bgr, W, H)
    out_names = [o.name for o in sess.get_outputs()]
    outs = dict(zip(out_names, sess.run(None, {sess.get_inputs()[0].name: blob})))
    dets = nms(decode(outs, W, H, 0.85), 0.3)
    assert dets, "manual decode found no face"
    score, box, lms = dets[0]

    # --- compare ---
    print(f"{'':12s}{'cv2 ground truth':>34s}{'manual decode':>28s}")
    print(f"{'score':12s}{gt_score:>34.4f}{score:>28.4f}")
    print(f"{'box':12s}{str(np.round(gt_box,1).tolist()):>34s}{str([round(v,1) for v in box]):>28s}")
    box_err = float(np.max(np.abs(np.array(gt_box) - np.array(box))))
    lm_err = float(np.max(np.abs(gt_lms - np.array(lms))))
    print(f"\nmax box coord error:  {box_err:.3f} px")
    print(f"max landmark error:   {lm_err:.3f} px")
    print(f"score error:          {abs(gt_score - score):.4f}")
    ok = box_err < 2.0 and lm_err < 2.0 and abs(gt_score - score) < 0.02
    print("\n" + ("✓ MANUAL DECODE MATCHES cv2 — safe to port to TS" if ok else "✗ MISMATCH — fix decode before porting"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
