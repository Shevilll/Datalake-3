# Benchmarks

> These numbers go straight onto the pitch slides. Fill them as they become **measured** (not estimated).
> **Rule (CLAUDE.md §0a):** the C3 `<1 s` latency number is the one measured on a **real ~3 GB-RAM Android device**.
> iPhone 17 Pro Max numbers are a *functional* check only and are reported separately, clearly labelled.

## 1. Model footprint (C2 — target ~7–8 MB, ceiling ~20 MB)

| Model | dtype | Size | Notes |
|---|---|---|---|
| YuNet (detect) | fp32 | **0.23 MB** | measured — MIT, OpenCV Zoo |
| MiniFASNet-V2 (passive liveness) | fp32 | **1.74 MB** | measured — Apache-2.0 |
| Recognition (embedding) | fp32 | **4.80 MB** | measured — our MIT MobileFaceNet export (D8) |
| Recognition (embedding) | **int8** | _TBD_ | headline compression (next) |
| Recognition (embedding) | fp16 | _TBD_ | accuracy-safe fallback (DECISIONS.md D4) |
| **TOTAL (shipped set, fp32)** | — | **6.77 MB** | **under the ~7–8 MB target, all 3 models** — vs 20 MB ceiling; int8 on recognition will cut further |

## 2. End-to-end latency (C3 — `<1 s` on mid-range Android)

End-to-end = detect → passive liveness → embed → match (one verify pass; excludes the user-paced active challenge).

| Device | Class | EP | Detect | Liveness | Embed | Match | **E2E** | Rubric-valid? |
|---|---|---|---|---|---|---|---|---|
| ~3 GB Android (target) | mid-range | NNAPI/XNNPACK | _TBD_ | _TBD_ | _TBD_ | _TBD_ | **_TBD_** | ✅ **this is the C3 number** |
| iPhone 17 Pro Max | flagship | CoreML | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | ❌ functional check only |

## 3. Quantization impact (Innovation — int8 story)

| Metric | fp32 | int8 | Δ |
|---|---|---|---|
| Recognition model size | _TBD_ | _TBD_ | |
| Embed latency (Android) | _TBD_ | _TBD_ | |
| Accuracy on held-out gallery | _TBD_ | _TBD_ | must stay > 95% (C5) |

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
