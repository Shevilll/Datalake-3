# Datalake FaceAuth

> **Hackathon 7.0** — offline facial recognition + liveness detection for field personnel on mid-range mobile, integrable into Datalake 3.0.
>
> One React Native codebase. Three ONNX models. **~3.3 MB total.** Zero network at inference time.

## Headline numbers

| Constraint | Target | Current |
|---|---|---|
| Total model footprint (C2) | ≤ 20 MB (smaller is better) | **3.33 MB** (int8 build, all 3 models) |
| End-to-end verify latency (C3) | < 1 s on mid-range device | **~620 ms median** (582–931 ms, n=40) on a **Redmi 9 Power** (M2010J19SI, SD662 — rubric-class) — **C3 met**; iPhone 17 Pro Max ~130 ms is a functional check only |
| Recognition discriminativeness | > 95% | sample-face separation margin **0.95** (fp32) / **0.89** (int8); on-device same-id cosine **0.79–0.86** across pose with multi-shot enrollment |
| Liveness (C7) | offline anti-spoofing | active gesture challenge (`headLeft / headRight / smile` binding + `blink` bonus, CSPRNG-randomized per verify); passive MiniFASNet logged informationally |
| License (C6) | open-source only, no additional licenses | YuNet **MIT**, MiniFASNet-V2 **Apache-2.0**, recognition **MIT** (our exported MobileFaceNet) |
| Cross-platform (C1) | iOS + Android, one codebase | Expo SDK 56 + RN 0.85 New Arch — no custom native (Vision Camera 5 + fast-opencv + ORT-RN). **Runs end-to-end on both iOS (iPhone 17 Pro Max) and Android (Redmi 9 Power)** — pipeline is platform-agnostic TS; a few screen-layer adaptations (capture, glass fallback, mirror) per D13/D14 |

The full table lives in [`docs/benchmarks.md`](docs/benchmarks.md).

## The integration story

```ts
import { FaceAuth } from '@/faceauth/FaceAuth';

await FaceAuth.preload();
await FaceAuth.register('emp-001');           // multi-shot
const r = await FaceAuth.verify();            // detect → embed → match + active challenge
const verified = r.matched && r.livenessPassed;
await FaceAuth.queueForSync({...});
await FaceAuth.syncNow();                     // mock cloud (drop in your real POST)
await FaceAuth.purgeLocal();                  // wipes embeddings + queue
```

That's the contract Datalake 3.0 calls. Step-by-step wiring in [`docs/integration-guide.md`](docs/integration-guide.md).

## Quick start (dev)

```bash
pnpm install                          # Expo SDK 56 dev build
npx expo prebuild --platform ios
npx expo run:ios --device <udid>      # signs with your Apple Development cert
npx expo start --dev-client           # Metro
```

Open the **Datalake FaceAuth** app on the device. Models load offline from the bundle (`assets/models/*.onnx`); the live demo runs in airplane mode after the JS bundle is loaded.

## Layout

```
/DECISIONS.md               ← every non-obvious choice + the deviations, dated
/LICENSES.md                ← every dependency + permissive license check (C6)
/README.md                  ← this file
/docs/
  benchmarks.md             ← footprint / latency / accuracy / liveness
  integration-guide.md      ← how Datalake 3.0 wires in FaceAuth
/assets/models/             ← 3 bundled ONNX models (3.33 MB total, int8)
/models/                    ← source models + provenance ledger + LICENSE files
/harness/                   ← Python verification harness + the int8 quantizer
/src/
  app/                      ← Expo Router screens (camera Register/Verify + Liquid Glass UI)
  faceauth/                 ← types, recipes, pipeline, gallery, FaceAuth facade
  sync/                     ← queue + mock cloud + purgeLocal (C8)
```

## Architecture, in one paragraph

A captured photo (Vision Camera 5, JPEG) is decoded to a BGR Mat by `react-native-fast-opencv`, fed through **YuNet** (640×640 detect, decoded in TypeScript), **ArcFace-aligned** to 112×112 via a 5-point similarity transform, **embedded** by a MIT-licensed **MobileFaceNet** (int8, ~1.36 MB) to a 512-d L2-normalized vector, and matched by cosine against a local multi-shot gallery. A randomized **active challenge** (head turn or smile) verifies a real person performed a commanded gesture; **MiniFASNet** passive runs in parallel (informational). Everything is on the JS thread via `onnxruntime-react-native` — *no custom Swift/Kotlin native code in v1* (`DECISIONS.md` D9). Enrolled embeddings are persisted in **AES-encrypted MMKV** (encrypted-at-rest, C8 — never raw images); the sync queue holds only audit records (outcome + cosine, no biometrics) and stays in-memory for the demo.

## Engineering decisions worth reading

The pivots that made the project work — `DECISIONS.md` is the audit trail:

- **D8** — recognition model: MIT-licensed MobileFaceNet, exported from `caojingtian1216` (validated discriminative on sample faces).
- **D9** — v1 uses no custom native code; Vision Camera 5 + fast-opencv + ORT-RN run the whole pipeline.
- **D10** — challenge selection uses a CSPRNG (anti-replay); `react-native-get-random-values` polyfill is installed and active (imported at app entry).
- **D11** — **active gesture is the binding liveness signal** (CSPRNG-randomized; defeats both photo and replay). Passive MiniFASNet was measured on real iPhone selfies AND 2D photos from the same pipeline and saturates on both — it doesn't discriminate on this device's camera distribution. We surface its score in `VerifyResult.passiveScore` as a **transparency / extensibility hook** so production can drop in a stronger fused passive model without touching the FaceAuth contract; we do NOT hard-gate on it.
- **D4** — int8 quantization is the headline compression (4.80 → 1.36 MB); fp16 is the zero-loss fallback.

## License

Apache-2.0 on our code. Every dependency + model is logged in [`LICENSES.md`](LICENSES.md) — all permissive, satisfying C6.
