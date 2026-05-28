"""
quantize_recognition.py — int8 (and fp16) quantization of the recognition model (DECISIONS.md D4/D8).

The headline compression step (§4.3, Innovation/C2). Produces:
  models/recognition.int8.onnx   (dynamic int8 — weights to int8)
  models/recognition.fp16.onnx   (float16 — if onnxconverter-common is available)
and validates that discriminativeness is retained vs the fp32 baseline on the sample faces:
  - same-identity cosine stays high, different-identity stays low
  - the int8 embedding stays ~parallel to the fp32 one (cos > 0.99 = negligible drift)
"""

from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np
from onnxruntime.quantization import QuantType, quantize_dynamic

sys.path.insert(0, str(Path(__file__).resolve().parent))
from verify_models import Detector, Recognition, cosine, RECOGNITION_PATH, YUNET_PATH  # noqa: E402

MODELS = Path(__file__).resolve().parent.parent / "models"
FP32 = MODELS / "recognition.onnx"
INT8 = MODELS / "recognition.int8.onnx"
FP16 = MODELS / "recognition.fp16.onnx"
SAMPLES = Path(__file__).resolve().parent / "samples"


def mb(p: Path) -> float:
    return p.stat().st_size / 1e6


def main() -> int:
    print(f"fp32 baseline: {FP32.name}  {mb(FP32):.2f} MB")

    # --- int8 (dynamic) ---
    quantize_dynamic(str(FP32), str(INT8), weight_type=QuantType.QInt8)
    print(f"int8 dynamic : {INT8.name}  {mb(INT8):.2f} MB  ({mb(INT8) / mb(FP32) * 100:.0f}% of fp32)")

    # --- fp16 (optional) ---
    have_fp16 = False
    try:
        import onnx
        from onnxconverter_common import float16

        m16 = float16.convert_float_to_float16(onnx.load(str(FP32)), keep_io_types=True)
        onnx.save(m16, str(FP16))
        have_fp16 = True
        print(f"fp16         : {FP16.name}  {mb(FP16):.2f} MB  ({mb(FP16) / mb(FP32) * 100:.0f}% of fp32)")
    except Exception as e:
        print(f"fp16         : skipped ({e})")

    # --- accuracy retention ---
    det = Detector(YUNET_PATH)
    rec32 = Recognition(FP32)
    rec8 = Recognition(INT8)
    rec16 = Recognition(FP16) if have_fp16 else None

    def embed(rec: Recognition, name: str, flip: bool = False) -> np.ndarray:
        bgr = cv2.imread(str(SAMPLES / f"{name}.jpg"))
        if flip:
            bgr = cv2.flip(bgr, 1)
        d = det.detect(bgr)
        assert d is not None, f"no face in {name}"
        return rec.embed(bgr, d.landmarks)

    print("\n=== discriminativeness (same-id = obama vs flipped obama; diff-id = obama vs biden) ===")
    print(f"{'model':6s}{'same-id cos':>14s}{'diff-id cos':>14s}{'margin':>10s}{'drift vs fp32':>16s}")
    for tag, rec in [("fp32", rec32), ("int8", rec8)] + ([("fp16", rec16)] if rec16 else []):
        o = embed(rec, "obama")
        of = embed(rec, "obama", flip=True)
        b = embed(rec, "biden")
        same = cosine(o, of)
        diff = cosine(o, b)
        drift = cosine(o, embed(rec32, "obama"))  # agreement with fp32 on the same input
        print(f"{tag:6s}{same:>14.4f}{diff:>14.4f}{same - diff:>10.4f}{drift:>16.4f}")

    print("\nLock int8 iff same-id stays high, diff-id stays low, drift ~1.0 (negligible). Else fp16 (D4).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
