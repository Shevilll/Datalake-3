# Benchmarks

> These numbers go straight onto the pitch slides. Fill them as they become **measured** (not estimated).
> **Rule (CLAUDE.md §0a):** the C3 `<1 s` latency number is the one measured on a **real ~3 GB-RAM Android device**.
> iPhone 17 Pro Max numbers are a *functional* check only and are reported separately, clearly labelled.

## 1. Model footprint (C2 — target ~7–8 MB, ceiling ~20 MB)

**Shipped:** int8 build, **3.33 MB total** (16.6% of the 20 MB ceiling).

| Model | dtype | Size | Notes |
|---|---|---|---|
| YuNet (detect) | fp32 | **0.23 MB** | measured — MIT, OpenCV Zoo |
| MiniFASNet-V2 (passive liveness) | fp32 | **1.74 MB** | measured — Apache-2.0 |
| Recognition (embedding) | **int8** | **1.36 MB** | **SHIPPED** — dynamic int8 (−72% vs fp32), discriminativeness retained |
| Recognition (embedding) — fallback | fp16 | 2.42 MB | bit-identical accuracy vs fp32; held in `models/recognition.fp16.onnx` for one-file swap if gallery eval (Slice 5) ever flags int8 (D4) |
| Recognition (embedding) — baseline | fp32 | 4.80 MB | our MIT MobileFaceNet export (D8), kept in `models/recognition.onnx` for reference |
| **TOTAL (shipped int8 build)** | — | **3.33 MB** | YuNet 0.23 + MiniFASNet 1.74 + recog-int8 1.36 |
| TOTAL (fp16 fallback build) | — | 4.39 MB | zero-accuracy-loss variant, still 22% of ceiling |
| TOTAL (fp32 baseline) | — | 6.77 MB | reference only — never shipped |

## 2. End-to-end latency (C3 — `<1 s` on mid-range Android)

End-to-end = detect → passive liveness → embed → match (one verify pass; excludes the user-paced active challenge).

| Device | Class | EP | Detect | Liveness | Embed | Match | **E2E** | Rubric-valid? |
|---|---|---|---|---|---|---|---|---|
| ~3 GB Android (target) | mid-range | NNAPI/XNNPACK | _TBD_ | _TBD_ | _TBD_ | _TBD_ | **_TBD_** | ✅ **this is the C3 number** |
| iPhone 17 Pro Max | flagship | CPU (default) | 13 ms | 2 ms | 3 ms | ~0 | **~128 ms** | ❌ functional check only |

**Slice 1 live verify (iPhone, 2026-05-28):** full register→verify on-device measured **~126–137 ms** end-to-end (JPEG decode + orientation-correct + detect + align + embed + match; single-shot, unoptimized — full-res 3088×2316 capture, no int8, default CPU EP). Detection 0.91–0.95. Same-person cosine ranged **0.44–0.84** across pose/expression on a single enrollment; one hard-angle shot dipped to **0.32** (false reject at τ=0.4) → multi-shot enrollment (match-against-max, already implemented) raises the floor; final τ_match tuned on the gallery (Slice 5). Different-context shots sat near **0.0–0.32** (correctly rejected). Purge verified live.

**On-device proof (iPhone 17 Pro Max, 2026-05-28):** all 3 models load from the bundle in **222 ms** (cold) and raw inference is **13 ms (YuNet) / 2 ms (MiniFASNet) / 3 ms (MobileFaceNet)** via onnxruntime-react-native on the **default CPU EP** (no CoreML yet). Output shapes verified on-device: `[1,6400,1]` etc. / `[1,3]` / `[1,512]`. These are raw model-inference times on dummy inputs — full E2E adds camera capture + OpenCV preprocessing + decode + alignment + matching, and the rubric C3 number must come from weak Android (§0a). CoreML/NNAPI EPs are expected to reduce these further.

## 3. Quantization impact (Innovation — int8 story)

| Metric | fp32 | int8 | fp16 |
|---|---|---|---|
| Recognition model size | 4.80 MB | **1.36 MB** (−72%) | 2.42 MB (−50%) |
| Embed latency (Android) | _TBD_ | _TBD_ | _TBD_ |
| Sample-face separation margin | 0.948 | 0.892 | 0.948 |
| Same-id / diff-id cosine (sample) | 0.920 / −0.029 | 0.897 / 0.004 | 0.920 / −0.029 |
| Accuracy on held-out gallery (C5) | _TBD_ | _TBD_ | _TBD_ |

*int8 retains discriminativeness on sample faces (margin 0.89) — **locked as shipped dtype 2026-05-28**. fp16 is bit-identical to fp32 and retained as a one-file swap fallback if the Slice 5 gallery eval ever flags real-world drop. Embedding latency comparison is measured on Android.*

## 4. Accuracy & robustness (C5 — `>95%`, diverse Indian demographics + outdoor lighting)

Internal gallery captured on-device across: harsh sun / low light / shadow / indoor; multiple skin tones; glasses/no-glasses; varied pose.

| Threshold | Value | TAR | FAR | FRR | Accuracy |
|---|---|---|---|---|---|
| τ_match (cosine) | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| τ_live (passive) | _TBD_ | — | — | — | — |

**Preliminary recognition sanity (harness, 2026-05-27 — not the gallery eval):** on MIT example faces, cos(same identity, flipped) = **0.92**, cos(different identities, Obama↔Biden) = **−0.03** → **0.95 separation margin**. Embedding L2-norm = 1.000; liveness softmax sums to 1.000; both 2D press photos scored passive-live = **0.000** (flat photo correctly flagged). Full gallery accuracy across lighting/demographics is the slice-5 eval that decides int8-vs-fp16 lock (D8).

## 5. Liveness defeat demos (C7)

| Attack | Defeated by | Result |
|---|---|---|
| Printed photo | passive MiniFASNet (`< τ_live`) | _TBD_ |
| Replayed video | randomized active challenge timeout | _TBD_ |

## 6. Memory footprint (C4 — runs in 3 GB RAM)

| Device | Peak RSS during verify | Notes |
|---|---|---|
| ~3 GB Android (target) | _TBD_ | |
| iPhone 17 Pro Max | _TBD_ | functional only |
