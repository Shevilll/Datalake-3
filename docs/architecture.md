# Architecture — Datalake FaceAuth

A deeper look at *why* the system is shaped the way it is. For *how to use it* see [`integration-guide.md`](integration-guide.md); for headline numbers see [`benchmarks.md`](benchmarks.md); for the decision log see [`../DECISIONS.md`](../DECISIONS.md).

## 1. Goals and constraints (recap)

| | Constraint | Implication |
|---|---|---|
| C1 | RN, iOS + Android, one codebase | TypeScript pipeline, platform-agnostic; no platform-specific business logic. |
| C2 | ≤ 20 MB model footprint | int8 quantization on the recognition model; tiny detector + spoof model. |
| C3 | < 1 s end-to-end verify | Heavy work in native (`fast-opencv` worklet) + ORT runs once per verify, not per frame. |
| C4 | Mid-range device (3 GB RAM) | Modest model sizes, no persistent inference loop, on-demand verify. |
| C5 | > 95% accuracy across demographics + lighting | Multi-shot enrollment, alignment via 5-point similarity transform, threshold tuned on a held-out gallery. |
| C6 | Open-source only | MIT / Apache-2.0 only; recognition weights re-exported by us (D8). |
| C7 | Offline liveness | Active gesture is the binding signal; passive MiniFASNet runs alongside (D11). |
| C8 | Sync / purge | Local queue + mock cloud + `purgeLocal()` wipe primitive. |

## 2. The shape of the system

```
                     ┌──────────────────────────────────────────────────────┐
                     │              React Native (Expo SDK 56)               │
                     │              TypeScript everywhere, strict             │
                     └──────────────────────────────────────────────────────┘

  ┌────────────┐         ┌────────────────────┐         ┌─────────────────────────┐
  │  Camera    │  frame  │   fast-opencv      │ Float32 │   onnxruntime-react-    │
  │ (Vision    ├────────►│   (worklet/JSI)    ├────────►│   native (ORT Mobile)   │
  │  Camera 5) │         │  resize/crop/warp/ │  NCHW   │  ┌───────────────────┐  │
  │ photoOut   │         │  cvtColor +        │ tensors │  │ YuNet  0.23MB MIT │  │
  │ -> JPEG    │         │  matToBuffer       │         │  │ MiniFASNet 1.74MB │  │
  └────────────┘         └────────────────────┘         │  │   Apache-2.0      │  │
                                                        │  │ MobileFaceNet     │  │
                                                        │  │   int8 1.36MB MIT │  │
                                                        │  └───────────────────┘  │
                                                        └────────────┬────────────┘
                                                                     │ 512-d L2-normed
                                                                     ▼
                            ┌─────────────────────────────────────────────────────┐
                            │   FaceAuth (§8 contract) — src/faceauth/FaceAuth.ts │
                            │   ─────────────────────────────────────────────────  │
                            │   register · verify · listEnrolled · deletePerson   │
                            │   queueForSync · syncNow · purgeLocal               │
                            └────┬──────────────────┬───────────────────────┬─────┘
                                 │                  │                       │
                       ┌─────────▼────────┐ ┌───────▼────────┐  ┌───────────▼───────────┐
                       │  pipeline.ts     │ │  gallery.ts    │  │  syncQueue.ts         │
                       │  detect/align/   │ │  encrypted     │  │  in-mem queue + mock  │
                       │  embed/match/    │ │  MMKV (AES-128)│  │  cloud + purgeLocal   │
                       │  passive +       │ │  multi-shot    │  │  (drop in real POST)  │
                       │  active-challenge│ │  embeddings    │  │                       │
                       │  geometry        │ │                │  │                       │
                       └──────────────────┘ └────────────────┘  └───────────────────────┘
```

## 3. Inference pipeline — exactly what happens per verify

```
takePhoto (JPEG, 720x960 target)
  └→ photoToMat: file → base64 → base64ToMat → Mat (BGR, true decoded dims via matToBuffer)
  └→ detectOriented:
        ├ try as-is → YuNet → primary face? exit
        ├ try 90cw → YuNet → primary face? exit
        ├ try 90ccw → YuNet → exit
        └ try 180  → YuNet → exit  (iOS strips EXIF, so we sweep orientations)
  └→ buildLivenessInput: clamp-scale 2.7x crop, aspect-preserving, shift-in-bounds
        → 80x80 BGR, /255, NCHW
        → MiniFASNet  → softmax [live, print, replay] → score (logged informationally; D11)
  └→ estimateSimilarityTransform: Umeyama-equivalent least-squares from
        5 detected landmarks → 5 ArcFace canonical reference points
  └→ warpAffine → 112x112 aligned crop → cvtColor BGR2RGB → (x-127.5)/128 → NCHW
        → MobileFaceNet (int8) → 512-d embedding → L2-normalize
  └→ matchAgainstGallery: cosine vs each enrollment, take max per person
  └→ computeGeometry from landmarks: yaw proxy + smile (mouth-corner spread)
  └→ satisfiesChallenge(challenge, geometry, yawSign=-1) → liveness verdict
  └→ verified = matched AND satisfiesChallenge
```

All times measured on iPhone 17 Pro Max (CPU EP, *functional-only*): YuNet ~13 ms, MiniFASNet ~2 ms, MobileFaceNet ~3 ms; E2E verify (including capture+decode+ multi-orientation detect) **~130 ms**. The C3 < 1 s number is now measured on a real **Redmi 9 Power** (M2010J19SI, SD662): **~620 ms median verify** (582–931 ms, n=40, CPU EP) — comfortably under budget (D13/D14; `docs/benchmarks.md` §2).

## 4. Why no custom native code (D9)

We weighed two paths in Spike B:

| Path | Pros | Cons |
|---|---|---|
| **v1 — no custom native** (chosen) | Cross-platform free, retires schedule risk, leverages MIT libs (`fast-opencv`, `onnxruntime-react-native`, `expo-glass-effect`) | per-frame work goes through JSI/worklet rather than pure native C++; ORT runs on JS thread, which is fine for *on-demand* verify |
| v2 — custom Nitro plugin | Truly all-native per frame; spec's purest path | iOS Swift/C++ + Android Kotlin/JNI, two integrations to maintain, biggest unknown in Spike B |

The hard constraint (C3) targets *one* verify in <1 s, not per-frame recognition. So v1 wins on schedule + portability with no performance cost on the binding path. Path v2 was documented as the escalation if the Android benchmark missed C3 — **but the real-device benchmark passed (~620 ms median on a Redmi 9 Power, 2026-05-30), so v1 stands and v2 is not needed.**

## 5. Why active gesture is the binding signal, passive is informational (D11)

We *built* dual liveness as the spec describes (passive MiniFASNet + active challenge, fused). On-device the single MiniFASNet export saturates to class 2 (replay) at p≈0.99 for **both** live iPhone selfies and 2D photos — so it can't be a hard gate without locking real users out. We left passive in the pipeline and the result object (transparency), but we made the **CSPRNG-randomized active gesture** the binding signal:

```
verified = matched   AND   active-challenge-satisfied
```

A static photo can't smile or turn on command; a pre-recorded video can't pre-position the right gesture because the challenge is unpredictable per verify. Passive remains a place where a production app can plug in a stronger (or fused two-model, per Silent-Face's original design) passive without changing the FaceAuth contract.

## 6. The integration boundary — `FaceAuth` (§8)

```ts
const FaceAuth = {
  preload(),                  // optional warm-up of 3 ORT sessions
  register(personId),         // captures + enrolls one shot (call multiple times)
  verify(),                   // active challenge + recognition + match
  listEnrolled(), deletePerson(personId),
  queueForSync(record),       // outcome only — never raw images
  syncNow(), purgeLocal(),
  setCaptureProvider(fn),     // host registers ONE function: how to obtain a captured face
  configure({ yawSign }),     // per-device calibration (front-camera mirror)
};
```

The `CaptureProvider` is the only thing Datalake's screen needs to provide. Internals (model paths, recipes, thresholds, MMKV key, even the recognition model itself) can swap without touching their code. We could move MobileFaceNet to a different export, switch to a Nitro C++ plugin, or change the encryption key strategy — no API breakage.

## 7. Threading model

| Stage | Thread |
|---|---|
| Camera preview | Vision Camera native + GPU |
| `capturePhotoToFile` | Vision Camera native, async to JS |
| File → base64 (`expo-file-system/legacy`) | JS, async |
| `OpenCV.base64ToMat` and all `invoke('warpAffine' \| 'cvtColor' \| 'rotate')` calls | fast-opencv JSI — synchronous on the JS thread but in native C++ |
| ORT `session.run` (YuNet / MiniFASNet / MobileFaceNet) | JS-thread async (ORT-RN dispatches to its own pool) |
| Cosine match, geometry, FaceAuth orchestration | JS thread |

The per-frame heavy work (color, warp, crops) is JSI-native via `fast-opencv` — *not* a JS↔native round-trip per frame. ORT inference happens once per verify on a small (640², 80², 112²) tensor.

## 8. Footprint, in detail

```
yunet.onnx              0.23 MB   (MIT)
minifasnet_v2.onnx      1.74 MB   (Apache-2.0; LICENSE shipped at models/minifasnet_v2.LICENSE)
recognition.onnx (int8) 1.36 MB   (MIT, our re-export of caojingtian1216 MobileFaceNet backbone)
────────────────────────────────────
TOTAL                   3.33 MB   ← 16.5% of the C2 20 MB ceiling
```

**int8 is locked as the shipped dtype** (D4, 2026-05-28) — sample-pair separation margin 0.892 vs fp32's 0.948 ≈ 6% loss, with same-id 0.897 and diff-id 0.005 still cleanly separated by more than 2× any reasonable `τ_match`. `recognition.fp16.onnx` (2.42 MB, bit-identical to fp32) is retained as a one-file swap fallback in `models/` if the Slice 5 gallery eval ever surfaces real-world drop.

## 9. What's persisted (and how)

| Data | Where | How |
|---|---|---|
| 3 ONNX models | `assets/models/` (bundled in the app binary) | Metro `assetExts` → `expo-asset` → ORT `InferenceSession.create(localUri)` |
| Enrolled embeddings | encrypted MMKV instance `datalake-faceauth-gallery` | AES-128 (encryptionKey constant for demo; production: device-bound Keychain/Keystore) |
| Sync queue + transmit log | in-memory module state (`src/sync/syncQueue.ts`) | swap to MMKV the same way the gallery did when production needs cross-restart durability |
| **NEVER persisted** | raw face images, the Mat buffer, JPEG payload | the source frame is discarded after the pipeline returns; only the 512-d L2-normalized embedding is kept |

`purgeLocal()` calls `MMKV.clearAll()` on the gallery instance + clears the in-memory queue + transmit log in a single function.

## 10. What's pending and how the architecture catches it

| Open item | Why architecture is ready | When |
|---|---|---|
| ~~Android < 1 s validation (C3)~~ — **done 2026-05-30** | Full pipeline runs end-to-end on a Redmi 9 Power (M2010J19SI, SD662): **~620 ms median verify** (582–931 ms), CPU EP — under budget. Pipeline ported unchanged; a few screen-layer adaptations (D13/D14). EP swap (NNAPI/XNNPACK) is the next optimization. | ✅ validated on real hardware |
| Accuracy gallery + threshold lock (C5) | `τ_match` is a single tunable, internal recognition is L2-normed → tuning is a one-number change. | Slice 5 |
| Stronger passive liveness | `passiveLiveness()` is one function. Swap MiniFASNet for a fused two-model export per Silent-Face's original design, or a more recent model, without touching the rest. | Production |
| Device-bound encryption key | `gallery.ts` reads `ENCRYPTION_KEY` from a constant today; swap for a function that pulls from `expo-secure-store` / Keychain / Keystore. | Production |
| Per-frame gesture validation | Today we verify the gesture from a single capture's landmarks. A throttled frame processor (already feasible with Vision Camera + fast-opencv) could verify *motion over time* for stronger anti-replay. | Production |

## 11. References

- [`../DECISIONS.md`](../DECISIONS.md) — the engineering spec and decisions log.
- [`../DECISIONS.md`](../DECISIONS.md) — every non-obvious choice, dated.
- [`integration-guide.md`](integration-guide.md) — how to use it.
- [`benchmarks.md`](benchmarks.md) — measured numbers.
- [`../LICENSES.md`](../LICENSES.md) — every dependency, every model, license-checked.
