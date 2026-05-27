# /models — provenance & licensing ledger

The three bundled ONNX models. **Every entry must have a confirmed permissive license (C6).**
Until a model's exact license + source commit is confirmed and recorded here, it does **not** ship.
Sizes here feed `docs/benchmarks.md` and the footprint slide (C2, target ~7–8 MB total).

| File | Role | Source (repo / release) | sha256 (short) | Size | License | Confirmed? |
|---|---|---|---|---|---|---|
| `yunet.onnx` | Detect + 5 landmarks | OpenCV Zoo `face_detection_yunet_2023mar.onnx` ([raw](https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx)) | `8f2383e4` | 232,589 B (0.23 MB) | MIT | ✅ |
| `minifasnet_v2.onnx` | Passive liveness | `garciafido/minifasnet-v2-anti-spoofing-onnx` @ sha `d29c8756` (export of `minivision-ai/Silent-Face-Anti-Spoofing`) | `d7b3cd9b` | 1,744,116 B (1.74 MB) | **Apache-2.0** (see `minifasnet_v2.LICENSE`) | ✅ |
| `recognition.onnx` | 512-d embedding | **our export** of `caojingtian1216/MobileFaceNet` **backbone only** (head dropped) → ONNX via `harness/export_mobilefacenet.py` | `de3ca6bd` | 4,798,636 B (4.80 MB) | **MIT** (weights repo) | ✅ (fp32; int8/fp16 + gallery accuracy pending, D8) |

**Verified IO (via `verify_models.py --introspect`):**
- `yunet.onnx`: in `[1,3,640,640]` f32; multi-scale cls/obj/bbox/kps heads → decoded by OpenCV `FaceDetectorYN` (not run raw through ORT).
- `minifasnet_v2.onnx`: in `[batch,3,80,80]` f32 → out `[batch,3]` (3-class logits) — matches §4.2 exactly. ✅
- `recognition.onnx`: in `[1,3,112,112]` f32 → out `[1,512]`. MobileFaceNet (1,220,914 params); `load_state_dict(strict)` matched our clean arch reimplementation. ✅

### `recognition.onnx` provenance (honest disclosure — DECISIONS.md D8 / C6)
- **Weights license:** MIT, declared by `caojingtian1216/MobileFaceNet` (HF). We export only the `backbone.*` (the 512-d embedding net); the training-only ArcFace classification `head` (512×72778) is discarded.
- **Architecture:** canonical MobileFaceNet, reimplemented cleanly in `harness/export_mobilefacenet.py` (we own this code).
- **Training data caveat:** the upstream checkpoint appears trained on an MS1M-derived face set (`faces_emore`-style, ~72.7k identities). The *weights* are MIT-declared by the publisher; the *dataset* carries the usual research-oriented terms. Documented transparently per the C6 strategy. If the gallery eval falls short, fall back per D8.
- **Preliminary quality:** same-identity cos 0.92 vs different-identity −0.03 (0.95 margin) on MIT sample faces.

## Recipe summary (authoritative copy lives in `harness/verify_models.py`)

- **YuNet:** run on downscaled frame (long side ~320–640), scale coords back. Gate on score/box-size/centering.
- **MiniFASNet-V2:** input `(1,3,80,80)` float32, **BGR**, crop = bbox expanded **2.7×** about center, `/255`, NCHW. Output 3 logits → softmax `[real, print, replay]`; `livenessScore = 1 - (p_print + p_replay)`.
- **Recognition:** input `(1,3,112,112)` float32, **RGB**, **5-landmark similarity-transform alignment** to 112×112, `(x-127.5)/128`, NCHW. Output 512-d → **L2-normalize**. Compare by cosine.

> ⚠️ Color order differs by model (liveness=BGR, recognition=RGB). Verify normalization against the *specific* export with the harness — some recognition exports use `/255` instead of `(x-127.5)/128`.

## Open items
- [ ] Download YuNet, MiniFASNet-V2, recognition exports; fill in commit/hash/size/license above.
- [ ] Confirm recognition-weights provenance is permissive (see `LICENSES.md` risk note). If not, swap for a cleanly-licensed MobileFaceNet.
- [ ] Run `python harness/verify_models.py --introspect` and reconcile reported IO shapes with the recipes above.
