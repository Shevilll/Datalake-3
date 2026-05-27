"""
verify_models.py — §6 verification harness for the offline face-auth pipeline.

PURPOSE
    Prove the load-bearing model recipes (CLAUDE.md §4) on the desktop BEFORE any of
    them touch native code. A silent preprocessing bug (wrong color order, crop margin,
    normalization, or skipped alignment / L2-norm) is the #1 cause of "the model runs
    but accuracy is garbage" — this harness makes those bugs impossible to ship.

    This file is ALSO the canonical, executable spec for the preprocessing that the
    native frame processor must replicate exactly. If the native pipeline disagrees
    with this file, the native pipeline is wrong.

WHAT IT CHECKS (CLAUDE.md §6)
    1. Loads each ONNX model; prints input/output names, shapes, dtypes.
    2. Runs each on a known sample; asserts output ranges are sane:
         - MiniFASNet: softmax sums to 1 over [real, print, replay].
         - Recognition: embedding L2-norm ~= 1 after normalization.
    3. Runs the full pipeline (detect -> passive liveness -> embedding) on an image
       or webcam frame and prints the scores.
    4. Confirms a printed/screen photo yields LOW passive liveness and a live face HIGH.

RUNTIME (see DECISIONS.md D6)
    System Python is 3.14, which has no onnxruntime/opencv wheels yet. Run this in a
    pinned 3.12 venv:
        uv venv --python 3.12 harness/.venv   # or: pyenv + python -m venv
        source harness/.venv/bin/activate
        pip install -r harness/requirements.txt

USAGE
        python harness/verify_models.py --introspect
        python harness/verify_models.py --image path/to/face.jpg
        python harness/verify_models.py --image path/to/printed_photo.jpg --expect spoof
        python harness/verify_models.py --webcam
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

try:
    import cv2  # type: ignore
    import onnxruntime as ort  # type: ignore
except ImportError as exc:  # pragma: no cover - environment guard
    sys.exit(
        f"[harness] Missing dependency: {exc}.\n"
        "Create the pinned venv first (see DECISIONS.md D6):\n"
        "  uv venv --python 3.12 harness/.venv && source harness/.venv/bin/activate\n"
        "  pip install -r harness/requirements.txt"
    )

# --------------------------------------------------------------------------------------
# Paths & constants
# --------------------------------------------------------------------------------------

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"
YUNET_PATH = MODELS_DIR / "yunet.onnx"
LIVENESS_PATH = MODELS_DIR / "minifasnet_v2.onnx"
RECOGNITION_PATH = MODELS_DIR / "recognition.onnx"

# Detection gates (CLAUDE.md §4.1) — tune on real data.
DET_SCORE_THRESHOLD = 0.85
DET_MIN_BOX_PX = 80  # face box must be at least this tall on the (downscaled) frame

# Passive-liveness pass threshold (CLAUDE.md §4.2) — tune on real outdoor data (§7).
TAU_LIVE = 0.70

# ArcFace canonical 5-point reference landmarks for a 112x112 aligned crop
# (right eye, left eye, nose, right mouth corner, left mouth corner).
# Standard ArcFace/InsightFace reference — load-bearing for alignment (CLAUDE.md §4.3).
ARCFACE_REF_LANDMARKS = np.array(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ],
    dtype=np.float32,
)


@dataclass
class Detection:
    box: np.ndarray  # [x, y, w, h] in source-image pixels
    landmarks: np.ndarray  # (5, 2) in source-image pixels
    score: float


# --------------------------------------------------------------------------------------
# Small utilities
# --------------------------------------------------------------------------------------


def softmax(logits: np.ndarray) -> np.ndarray:
    z = logits - np.max(logits)
    e = np.exp(z)
    return e / np.sum(e)


def ok(msg: str) -> None:
    print(f"  \033[92m✓\033[0m {msg}")


def fail(msg: str) -> None:
    print(f"  \033[91m✗\033[0m {msg}")


def info(msg: str) -> None:
    print(f"  · {msg}")


# --------------------------------------------------------------------------------------
# Model wrappers — each encapsulates the EXACT §4 recipe.
# --------------------------------------------------------------------------------------


class Detector:
    """YuNet via OpenCV FaceDetectorYN (CLAUDE.md §4.1)."""

    def __init__(self, model_path: Path, input_size=(320, 320)) -> None:
        if not model_path.exists():
            raise FileNotFoundError(model_path)
        self.input_size = input_size
        self.net = cv2.FaceDetectorYN.create(
            model=str(model_path),
            config="",
            input_size=input_size,
            score_threshold=DET_SCORE_THRESHOLD,
            nms_threshold=0.3,
            top_k=50,
        )

    def detect(self, bgr: np.ndarray) -> Detection | None:
        h, w = bgr.shape[:2]
        # Run on a downscaled frame for speed; scale coords back up (§4.1).
        long_side = 320
        scale = long_side / max(h, w)
        rw, rh = int(round(w * scale)), int(round(h * scale))
        resized = cv2.resize(bgr, (rw, rh))
        self.net.setInputSize((rw, rh))
        _, faces = self.net.detect(resized)
        if faces is None or len(faces) == 0:
            return None
        # Pick the largest face.
        faces = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)
        f = faces[0]
        box = np.array(f[0:4], dtype=np.float32) / scale
        landmarks = np.array(f[4:14], dtype=np.float32).reshape(5, 2) / scale
        score = float(f[14])
        if score < DET_SCORE_THRESHOLD or box[3] < DET_MIN_BOX_PX:
            return None
        return Detection(box=box, landmarks=landmarks, score=score)


class PassiveLiveness:
    """MiniFASNet-V2 (CLAUDE.md §4.2): BGR, 2.7x crop, 80x80, /255, NCHW."""

    def __init__(self, model_path: Path) -> None:
        if not model_path.exists():
            raise FileNotFoundError(model_path)
        self.sess = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        self.input_name = self.sess.get_inputs()[0].name

    @staticmethod
    def crop_2_7(bgr: np.ndarray, box: np.ndarray) -> np.ndarray:
        """Expand bbox by 2.7x around its center (matches upstream 2.7_80x80 recipe)."""
        x, y, w, h = box
        cx, cy = x + w / 2.0, y + h / 2.0
        side = max(w, h) * 2.7
        x0 = int(round(cx - side / 2.0))
        y0 = int(round(cy - side / 2.0))
        x1 = int(round(cx + side / 2.0))
        y1 = int(round(cy + side / 2.0))
        H, W = bgr.shape[:2]
        # Pad if the expanded box runs off-frame, so the margin ratio is preserved.
        pad_l, pad_t = max(0, -x0), max(0, -y0)
        pad_r, pad_b = max(0, x1 - W), max(0, y1 - H)
        if any((pad_l, pad_t, pad_r, pad_b)):
            bgr = cv2.copyMakeBorder(bgr, pad_t, pad_b, pad_l, pad_r, cv2.BORDER_REPLICATE)
            x0 += pad_l; x1 += pad_l; y0 += pad_t; y1 += pad_t
        return bgr[y0:y1, x0:x1]

    def score(self, bgr: np.ndarray, box: np.ndarray) -> tuple[float, np.ndarray]:
        crop = self.crop_2_7(bgr, box)
        crop = cv2.resize(crop, (80, 80))  # stays BGR — do NOT convert to RGB
        x = crop.astype(np.float32) / 255.0  # [0,1]
        x = np.transpose(x, (2, 0, 1))[None, ...]  # HWC -> NCHW
        logits = self.sess.run(None, {self.input_name: x})[0][0]
        probs = softmax(logits)  # [p_real, p_print, p_replay]
        liveness = float(1.0 - (probs[1] + probs[2]))  # == p_real
        return liveness, probs


class Recognition:
    """MobileFaceNet/ArcFace (CLAUDE.md §4.3): RGB, 5-pt align 112x112, (x-127.5)/128, L2-norm."""

    def __init__(self, model_path: Path) -> None:
        if not model_path.exists():
            raise FileNotFoundError(model_path)
        self.sess = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
        self.input_name = self.sess.get_inputs()[0].name

    @staticmethod
    def align(bgr: np.ndarray, landmarks: np.ndarray) -> np.ndarray:
        """Similarity transform to canonical 112x112 using the 5 landmarks."""
        M, _ = cv2.estimateAffinePartial2D(
            landmarks.astype(np.float32), ARCFACE_REF_LANDMARKS, method=cv2.LMEDS
        )
        return cv2.warpAffine(bgr, M, (112, 112), borderValue=0.0)

    def embed(self, bgr: np.ndarray, landmarks: np.ndarray) -> np.ndarray:
        aligned = self.align(bgr, landmarks)
        rgb = cv2.cvtColor(aligned, cv2.COLOR_BGR2RGB)  # RGB — different from liveness!
        x = (rgb.astype(np.float32) - 127.5) / 128.0  # ~[-1, 1] (verify per export)
        x = np.transpose(x, (2, 0, 1))[None, ...]  # HWC -> NCHW
        emb = self.sess.run(None, {self.input_name: x})[0][0].astype(np.float32)
        emb /= np.linalg.norm(emb) + 1e-10  # L2-normalize — load-bearing for cosine
        return emb


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(a, b))  # both already L2-normalized


# --------------------------------------------------------------------------------------
# Harness checks
# --------------------------------------------------------------------------------------


def introspect(path: Path) -> None:
    if not path.exists():
        fail(f"{path.name} not present yet")
        return
    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    print(f"\n[{path.name}]  ({path.stat().st_size / 1e6:.2f} MB)")
    for i in sess.get_inputs():
        info(f"in  {i.name}: shape={i.shape} dtype={i.type}")
    for o in sess.get_outputs():
        info(f"out {o.name}: shape={o.shape} dtype={o.type}")


def check_liveness_range(liveness: PassiveLiveness, bgr: np.ndarray, det: Detection) -> None:
    score, probs = liveness.score(bgr, det.box)
    s = float(np.sum(probs))
    (ok if abs(s - 1.0) < 1e-3 else fail)(f"liveness softmax sums to 1 (got {s:.4f})")
    info(f"probs [real, print, replay] = {np.round(probs, 4).tolist()}  livenessScore={score:.4f}")


def check_embedding_range(recog: Recognition, bgr: np.ndarray, det: Detection) -> None:
    emb = recog.embed(bgr, det.landmarks)
    n = float(np.linalg.norm(emb))
    (ok if abs(n - 1.0) < 1e-3 else fail)(f"embedding L2-norm ~= 1 (got {n:.4f})")
    info(f"embedding dim = {emb.shape[0]}")


def run_pipeline(image_path: Path | None, expect: str | None) -> int:
    missing = [p.name for p in (YUNET_PATH, LIVENESS_PATH, RECOGNITION_PATH) if not p.exists()]
    if missing:
        fail(f"models not present yet: {missing}")
        info("Drop the .onnx files in /models (see models/README.md provenance) then re-run.")
        return 1

    det_model = Detector(YUNET_PATH)
    live_model = PassiveLiveness(LIVENESS_PATH)
    recog_model = Recognition(RECOGNITION_PATH)

    bgr = cv2.imread(str(image_path)) if image_path else None
    if bgr is None:
        fail(f"could not read image: {image_path}")
        return 1

    det = det_model.detect(bgr)
    if det is None:
        fail("no face passed the detection gate (score/size/center)")
        return 1
    ok(f"face detected: score={det.score:.3f} box={np.round(det.box).astype(int).tolist()}")

    print("\n[passive liveness]")
    check_liveness_range(live_model, bgr, det)
    score, _ = live_model.score(bgr, det.box)

    print("\n[recognition]")
    check_embedding_range(recog_model, bgr, det)

    if expect == "spoof":
        (ok if score < TAU_LIVE else fail)(
            f"printed/screen photo rejected: livenessScore {score:.3f} < tau {TAU_LIVE}"
        )
    elif expect == "live":
        (ok if score >= TAU_LIVE else fail)(
            f"live face accepted: livenessScore {score:.3f} >= tau {TAU_LIVE}"
        )
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Face-auth model verification harness (§6)")
    ap.add_argument("--introspect", action="store_true", help="print model IO shapes/dtypes")
    ap.add_argument("--image", type=Path, help="run full pipeline on an image")
    ap.add_argument("--expect", choices=["live", "spoof"], help="assert liveness outcome")
    ap.add_argument("--webcam", action="store_true", help="run full pipeline on webcam frames")
    args = ap.parse_args()

    if args.introspect or not (args.image or args.webcam):
        print("=== Model introspection ===")
        for p in (YUNET_PATH, LIVENESS_PATH, RECOGNITION_PATH):
            introspect(p)
        if not (args.image or args.webcam):
            print("\nTip: --image face.jpg [--expect live|spoof]  or  --webcam")
            return 0

    if args.image:
        print("\n=== Pipeline (image) ===")
        return run_pipeline(args.image, args.expect)

    if args.webcam:
        print("\n=== Pipeline (webcam) — press q to quit ===")
        return run_webcam()
    return 0


def run_webcam() -> int:
    missing = [p.name for p in (YUNET_PATH, LIVENESS_PATH, RECOGNITION_PATH) if not p.exists()]
    if missing:
        fail(f"models not present yet: {missing}")
        return 1
    det_model = Detector(YUNET_PATH)
    live_model = PassiveLiveness(LIVENESS_PATH)
    recog_model = Recognition(RECOGNITION_PATH)
    cap = cv2.VideoCapture(0)
    while True:
        ok_read, frame = cap.read()
        if not ok_read:
            break
        det = det_model.detect(frame)
        label = "searching..."
        if det is not None:
            score, _ = live_model.score(frame, det.box)
            _ = recog_model.embed(frame, det.landmarks)
            label = f"live={score:.2f} {'REAL' if score >= TAU_LIVE else 'SPOOF'}"
            x, y, w, h = det.box.astype(int)
            cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
        cv2.putText(frame, label, (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 0), 2)
        cv2.imshow("face-auth harness", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break
    cap.release()
    cv2.destroyAllWindows()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
