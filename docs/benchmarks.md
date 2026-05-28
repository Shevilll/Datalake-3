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
| τ_live (passive) | n/a — not a binding gate (D11) | — | — | — | — |

**Preliminary recognition sanity (harness, 2026-05-27 — not the gallery eval):** on MIT example faces, cos(same identity, flipped) = **0.92**, cos(different identities, Obama↔Biden) = **−0.03** → **0.95 separation margin**. Embedding L2-norm = 1.000. Full gallery accuracy across lighting/demographics is the Slice 5 eval.

**Passive-liveness sanity, corrected (D11):** the harness's earlier observation that "press photos score passive-live = 0.000" looked like correct flagging in isolation, but **on-device testing of live iPhone-front-camera selfies returned the same passive-live ≈ 0** — the model saturates to class 2 (replay) regardless of input on this device's camera distribution. The 0.000 score is therefore **saturation**, not discrimination. The harness sanity check was incomplete because it never compared a live face from the same pipeline; the on-device measurement is the load-bearing one. **`τ_live` is not a binding gate in our shipped pipeline** — active gesture is (§5).

## 5. Liveness defeat demos (C7)

**Defeat mechanism for BOTH attacks: the CSPRNG-randomized active gesture** (`headLeft` / `headRight` / `smile`, picked unpredictably per verify; D11). Passive MiniFASNet runs and its score is surfaced in `passiveScore` for transparency / future fusion, but it is **not a binding gate** on the shipped pipeline — it saturates on this camera distribution and would block real users if hard-gated.

| Attack | Defeated by | Mechanism | Expected demo outcome |
|---|---|---|---|
| Printed photo (or photo on a 2nd phone screen) | active CSPRNG-randomized gesture | a flat 2D photo cannot perform the prompted gesture on command (no smile, no head turn) | `❌ Challenge failed — <prompt>` on every verify attempt; recognition cosine may match (the printed face still looks like the enrolled face) but liveness fails ⇒ `verified = false` |
| Replayed video of the enrolled subject sitting neutrally | active CSPRNG-randomized gesture | the recorded video doesn't perform the on-demand gesture; the prompt is unpredictable per verify so the attacker can't pre-position the right gesture | `❌ Challenge failed` on every attempt; for stronger guarantee, swap to `randomChallengeSequence(2)` — replay attack success drops to **(1/3)² ≈ 11%** under pure guessing (~1.6 bits of entropy per challenge, 3.17 bits for n=2) |
| Replayed video of the subject performing one gesture (e.g. always smiling) | randomization + sequence | single-challenge verify: attacker has ~1/3 chance the prompt happens to match the recorded gesture; defeated probabilistically ⇒ require `n≥2` sequence in production for hard guarantees | `❌ Challenge failed` ~67% of attempts; 1/3 probabilistic pass is the honest disclosure — addressed by the sequenced-challenge API already shipped (`randomChallengeSequence`) |

**Live-demo numbers to fill at submission:** ratio of `❌ Challenge failed` results across N=10 replay attempts of each attack class.

## 6. Memory footprint (C4 — runs in 3 GB RAM)

| Device | Peak RSS during verify | Notes |
|---|---|---|
| ~3 GB Android (target) | _TBD_ | |
| iPhone 17 Pro Max | _TBD_ | functional only |
