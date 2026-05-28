# Integrating FaceAuth into Datalake 3.0

A single TypeScript module — `FaceAuth` — gives you the entire offline face recognition + liveness pipeline behind seven typed methods. This guide shows how to wire it into your app.

## What you get

```ts
import { FaceAuth } from '@/faceauth/FaceAuth';

await FaceAuth.preload();                            // warm the 3 ORT sessions (optional)
await FaceAuth.register('emp-001');                  // multi-shot enrollment
const result = await FaceAuth.verify();              // active-challenge + recognition
await FaceAuth.queueForSync({ id, personId, ...});   // offline queue
await FaceAuth.syncNow();                            // drain when online
await FaceAuth.purgeLocal();                         // wipe embeddings + queue
```

All inference and matching happen **on-device, fully offline**. The only thing FaceAuth needs from you is *how to obtain a captured photo* — the rest is its own.

## 1. Dependencies (already in our `package.json`)

`react-native-vision-camera` (camera + photo output), `react-native-fast-opencv` (preprocessing), `onnxruntime-react-native` (inference), `expo-glass-effect` (iOS 26 UI). The three bundled ONNX models live in `assets/models/` and are loaded by `src/faceauth/ort.ts` via `expo-asset`.

## 2. Install a `CaptureProvider`

`FaceAuth` is UI-agnostic. Your camera screen registers **one** function that returns a captured face:

```ts
import { FaceAuth, type CapturedFace } from '@/faceauth/FaceAuth';
import { photoToMat } from '@/faceauth/capture';

// inside your camera screen component, on mount:
FaceAuth.setCaptureProvider(async (challenge) => {
  if (challenge) {
    // VERIFY path: show the prompt to the user and wait for them to perform the gesture
    await showChallengePromptAndWaitForCapture(challenge);
  }
  const photo = await photoOutput.capturePhotoToFile({ flashMode: 'off' }, {});
  const { mat, width, height } = await photoToMat(photo.filePath);
  return { mat, width, height } satisfies CapturedFace;
});
return () => FaceAuth.setCaptureProvider(null); // cleanup on unmount
```

The `challenge` argument is undefined on `register()` and one of `'headLeft' | 'headRight' | 'smile'` on `verify()` — your screen displays the prompt only when present.

## 3. Register (multi-shot enrollment)

Call `register()` multiple times for the same `personId` covering 3–5 pose variations (frontal + slight left/right + a smile). Matching takes the **best** cosine across stored embeddings, which is the load-bearing UX detail for pose robustness on this model.

```ts
const { ok, samples } = await FaceAuth.register('emp-001');
// `samples` is the running enrollment count for that personId
```

## 4. Verify (with active liveness)

```ts
const r: VerifyResult = await FaceAuth.verify();
// {
//   matched: boolean,             // cosine >= τ_match
//   personId: string | null,
//   confidence: number,           // cosine similarity
//   livenessPassed: boolean,      // active challenge satisfied (binding signal, D11)
//   passiveScore: number,         // informational only
//   activeChallenge: 'headLeft' | 'headRight' | 'smile',
//   latencyMs: number,
// }
const verified = r.matched && r.livenessPassed;  // your fusion rule
```

The verifier composes detection (YuNet) → alignment (5-pt similarity transform) → 512-d MobileFaceNet embedding → cosine match against the local gallery, **and** computes head-yaw / mouth-spread geometry from YuNet's landmarks to check that the user performed the randomized challenge.

## 5. Offline sync queue + purge (C8 / §10)

```ts
await FaceAuth.queueForSync({
  id: 'evt-' + Date.now(),
  personId: r.personId,
  timestamp: Date.now(),
  matched: r.matched,
  confidence: r.confidence,
  livenessPassed: r.livenessPassed,
}); // never contains raw images — embeddings + outcome only

// later, when the device is online:
await FaceAuth.syncNow();             // drains to your cloud endpoint
// for the demo this is a mock; swap the mock in src/sync/syncQueue.ts for your real POST.

await FaceAuth.purgeLocal();          // wipes ALL embeddings + queue + transmit log
```

## 6. Files you'll touch

| File | Purpose |
|---|---|
| `src/faceauth/FaceAuth.ts` | The §8 facade — the only file consumers import. |
| `src/faceauth/types.ts` | `VerifyResult`, `VerificationRecord`, `FaceAuthApi`. |
| `src/faceauth/capture.ts` | `photoToMat()` — JPEG path → BGR Mat with true decoded dims. |
| `src/sync/syncQueue.ts` | Swap `mockCloudUpload` for your real endpoint. |
| `assets/models/*.onnx` | The three bundled models (YuNet, MiniFASNet, MobileFaceNet). |
| `src/app/index.tsx` | Sample integration: a Register/Verify camera screen using the facade. |

## 7. Architecture notes (for the curious)

- **No custom native code** for v1 — Vision Camera 5 + fast-opencv + ORT-RN do the heavy lifting (`DECISIONS.md` D9). Cross-platform out of the box.
- **Models load offline from the app bundle** via `expo-asset` + Metro's `assetExts`. The full models are ~3.3 MB (int8) — well under the 20 MB brief target.
- **Active liveness is the binding signal** (`DECISIONS.md` D11). Passive (MiniFASNet) is logged for transparency but doesn't gate, because on modern selfies the single export was indecisive.
- **Front-camera yaw sign** is calibrated per device — adjust via `FaceAuth.configure({ yawSign: -1 })`.

## 8. End-to-end flow at a glance

```
[Your screen] tap Register
   └→ FaceAuth.register('emp-001')
        └→ captureProvider() → photo → Mat
        └→ enrollFromMat() → embedding → gallery

[Your screen] tap Verify
   └→ FaceAuth.verify()
        └→ randomChallenge() = 'headLeft' | 'headRight' | 'smile'
        └→ captureProvider(challenge)
              └→ your UI shows the prompt, waits, captures
        └→ verifyFromMat() → detect → embed → match
        └→ satisfiesChallenge(geometry) → liveness verdict
        └→ VerifyResult to caller
```

That's the integration. Everything else is opinion.
