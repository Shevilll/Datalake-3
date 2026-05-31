# DECISIONS.md

> Running log of non-obvious engineering choices and deviations from the engineering spec.
> Format: each entry is dated, states the options, the choice, and the reasoning. Newest first.

---

## D14 — 2026-05-30 — Android runtime bring-up: snapshot capture, Liquid-Glass light fallback, platform yaw-sign — **all confined to the screen layer, pipeline untouched**

- **Trigger:** with the D13 crash fixed, the app launched on the Redmi 9 Power but three runtime issues surfaced that never appeared on the iOS dev device. All were diagnosed on-device (wireless adb + logcat + the in-app `[FaceAuth]` logs); none required touching `src/faceauth/` (the pipeline stayed platform-agnostic).
- **1 — Camera never started ("Starting camera…" forever).** logcat: `CameraCaptureSession: failed to create capture session; configuration failed` / Qualcomm `CHIUSECASE CreateUsecaseObject failed`, retrying every ~4 s. vision-camera v5 builds the CameraX session as `[preview, photo]`; this budget SD662 HAL **cannot configure the preview + ImageCapture stream combination** (verified: preview-only configures with 0 failures; adding the photo output fails at every photo size, large or small). **Decision:** on Android, drop the dedicated photo output and capture via `cameraRef.takeSnapshot()` — the preview frame (single stream) saved to a JPEG, fed to the existing `photoToMat` decode path. iOS keeps the photo output (its HAL handles the combo and the sensor image is higher quality). Register and Verify share the capture fn, so enroll/verify mirroring stays consistent.
- **2 — UI not light-themed.** `expo-glass-effect`'s `<GlassView>` renders the real iOS 26 Liquid Glass material only on iOS 26+; **everywhere else it degrades to a plain transparent `<View>`**, leaving the panels invisible over the camera (reads as "not light mode"). The engineering spec §3c mandated providing the fallback look; it was missing. **Decision:** when `isLiquidGlassAvailable()` is false (Android / iOS <26), paint each glass surface as a solid light card (white-ish bg, hairline border, soft shadow; primary action → solid accent), plus a dark-icon `StatusBar`. iOS 26 keeps pure glass untouched.
- **3 — Head-turn (left/right) failed every time; smile worked.** The iOS photo capture and the Android `takeSnapshot()` preview **mirror differently**, so a physical right-turn yields **+yaw on Android** but **−yaw on iOS**. The iOS-tuned `yawSign = -1` therefore inverts left/right on Android. Measured on-device (forced `headRight`, n≈10): turning right gave raw yaw ≈ +0.37..+0.46; with the fix the prompted direction passes (right→+0.30/+0.33→✅, left→−0.23→✅). `smile` is mirror-invariant, which is exactly why only left/right broke. **Decision:** `yawSign = Platform.OS === 'android' ? 1 : -1`. Measured, not guessed.
- **Why screen-layer `Platform.OS` branches are acceptable here:** the cross-platform guarantee we make is about the **pipeline** (`src/faceauth/`), which remains branch-free and native-import-free. Capture method, mirror sign, and the glass fallback are inherently presentation/hardware concerns and belong in the screen. Documented so the deck's cross-platform claim stays honest (it now says "pipeline ported unchanged; screen layer needed a few small adaptations").
- **Result:** full flow verified on the Redmi — camera live, light theme, all three challenges + bonus blink, ✅ verify (cos 0.73–0.87), ❌ challenge-failed, ~620 ms median verify. Captured in `androidDemo/`.

## D13 — 2026-05-30 — Android first-run crash: force-autolink `onnxruntime-react-native` + bridgeless-safe binding — **two-layer fix, verified on a real Redmi 9 Power (M2010J19SI, budget SD662)**

- **Symptom:** the first-ever Android build (EAS preview APK) crashed instantly on launch — "does not even open". Captured the real cause from on-device `adb logcat` (wireless debugging; the only Android device available is a Redmi M2010J19SI, the rubric-class hardware): `TypeError: Cannot read property 'install' of null` thrown by `onnxruntime-react-native`'s `binding.ts` at JS module-load time, which (because `src/faceauth/ort.ts` imports ORT at startup) takes down the whole bundle before any UI renders. Native init (SoLoader, Hermes, ExpoModulesCore) all succeeded — this was a JS-layer failure, not a missing `.so`.
- **Primary root cause (Android-only):** ORT ships a stale `unimodule.json` (legacy Expo "unimodules" marker, `platforms: ["ios","android"]`). `expo-modules-autolinking`'s `react-native-config` resolver discovers it via `discoverExpoModuleConfigAsync` (which reads `expo-module.config.json` **and** `unimodule.json`), decides ORT is an Expo module, and — seeing ORT also has its own `android/build.gradle` with no Expo `android.gradlePath` redirect — **defers it** (`androidResolver.js`: "the RN module has a gradle file and the Expo module doesn't redirect it… we can't link both", `return null`). But ORT is *not* a real Expo module (no Kotlin `Module`, no `expo-module.config.json`), so Expo autolinking never registers its `OnnxruntimePackage` (a plain RN `ReactPackage`) either. Net: the `Onnxruntime` native module is **absent** on Android, so both `NativeModules.Onnxruntime` and the TurboModule interop return null. iOS is unaffected because CocoaPods links ORT via its podspec glob, independent of `PackageList`.
- **Secondary issue (would bite once registered):** ORT's binding resolves its module via legacy `NativeModules.Onnxruntime`, which is `null` under **bridgeless New Architecture** (confirmed `BridgelessReact` in logcat). Bridgeless surfaces legacy modules through the `global.__turboModuleProxy` interop (enabled because `ReactNativeNewArchitectureFeatureFlagsDefaults.useTurboModuleInterop()` returns `newArchitectureEnabled || …` ⇒ true), not via the plain `NativeModules` object.
- **Fix (two layers, both committed):**
  1. **`react-native.config.js`** (new, project root) — explicit `dependencies['onnxruntime-react-native'].platforms.android` override (`packageImportPath`/`packageInstance`/`sourceDir`). Providing a defined android config makes `resolveReactNativeModule` skip the Expo-deferral branch and link ORT as a normal RN package. **Android-only override — iOS autolinking is left exactly as-is (it already worked).** Verified locally before rebuilding: `expo-modules-autolinking react-native-config --platform android` now lists ORT (13→14 deps, nothing else changed).
  2. **pnpm patch to ORT `binding.ts` / `dist/*/binding.js`** (extends the existing `patches/onnxruntime-react-native@1.24.3.patch`) — resolve via `TurboModuleRegistry.get('Onnxruntime') ?? NativeModules.Onnxruntime` (works on both architectures) and throw a clear "native module not found" error instead of the cryptic null-deref. Survives EAS's fresh install via `patchedDependencies`.
- **Alternatives weighed:** (a) delete ORT's `unimodule.json` via the patch — fixes both platforms uniformly and removes the root-cause artifact, but risks perturbing the *working* iOS pod-linking path, which can't be tested on the Mac-less-Android-SDK dev box; rejected in favour of the surgical Android-only override. (b) disable bridgeless/New Arch — impossible here: Nitro (`react-native-vision-camera@5`, `react-native-nitro-*`) and Reanimated 4 require New Arch.
- **Verification (on-device, not just static):** rebuilt the EAS preview APK, installed over wireless adb (MIUI blocks `adb install` with `INSTALL_FAILED_USER_RESTRICTED`, so push-to-Downloads + manual tap), relaunched with a clean logcat. Result: no exception, app reaches the camera screen, and `[FaceAuth] models loaded — ready` confirms all three ONNX sessions load through ORT. The Android pipeline now runs end-to-end on the rubric-class device.

## D12 — 2026-05-28 — Add blink as a NON-BINDING bonus challenge (satisfies "blink" in the brief without risking on-stage false-rejects)

- **Trigger:** the hackathon brief's deliverable 1a lists "blink, smile, or turn their head slightly" as examples. We ship smile + head-turn as binding (D3/D11). To pre-empt a judge looking specifically for blink without weakening the binding-pass guarantee, add blink as a bonus prompt.
- **Why blink can't be a binding signal on this stack:** YuNet exposes 5 landmarks — eye *centres*, nose tip, mouth corners. A true EAR (Eye Aspect Ratio) needs upper/lower eyelid contours (≥6 pts per eye). With centres only, any proxy is geometrically weak — the rendered eye-centre Y position drifts at most ~1–2 px on closure vs ~50–80 px interocular. Single-shot capture of a transient blink is even noisier (the user is supposed to blink, then tap Capture — eyes are open at the moment we measure). A false-reject of a real person on stage is materially worse than not implementing blink at all.
- **Decision:** ship blink as a labelled BONUS challenge.
  - `ActiveChallenge` gains `'blink'`; `BINDING = ['headLeft','headRight','smile']` and `ALL_WITH_BONUS = [...BINDING, 'blink']`.
  - `randomChallenge()` continues to pick only from BINDING — the fusion gate is unchanged. `randomChallengeWithBonus()` picks from BINDING ∪ {blink} so the demo surfaces blink ~25% of attempts when wired in.
  - `satisfiesChallenge('blink', g, …)` returns a noisy proxy (eyeMid→nose vertical distance / interocular > threshold), explicitly labelled informational. Callers MUST gate fusion on `isBindingChallenge(c) ? satisfiesChallenge(c, …) : true` so bonus prompts auto-pass the verdict.
  - Prompt is labelled "Blink twice (bonus)" so the user + judges see this is the optional one.
- **Result:** brief's example list is fully covered (blink + smile + head-turn all visible); the binding security property is unchanged; stage demo can't false-reject on a noisy proxy.

## D11 — 2026-05-28 — Slice 2 fusion lock: active is the binding liveness signal; passive is exposed as a transparency / extensibility hook (not a gate)

- **Trigger:** on-device passive testing showed MiniFASNet-V2 saturates to class 2 (replay)
  with p≈0.99 for **both** 2D photos and live iPhone-front-camera selfies — i.e. it doesn't
  discriminate live vs spoof on this device class. Recipe matches the model card; the issue
  is model bias / training-data mismatch, not preprocessing.
- **Pivot (planned in D8 as the fallback):** drop the **hard** passive gate; make the
  randomized **active challenge** (`headLeft`/`headRight`/`smile`) the binding liveness proof.
  Passive still runs and is logged (informational), but `verified = matched AND satisfiesChallenge`.
- **Calibrated parameters (on-device, 2026-05-28):**
  - `yawSign = -1` (front-camera mirror — turning LEFT yields **+yaw** on this build).
  - `yawTurn = 0.15` (moderate turn satisfies, extreme turns avoided to keep recognition cos high).
  - `smileSpread = 0.75` (YuNet mouth corners run lower than textbook anthropometry; observed
    smile range 0.76–0.91, neutral 0.64–0.79 — threshold splits these adequately).
  - Prompts soften to "Turn slightly LEFT/RIGHT" so users don't overshoot and break recognition.
- **Unlock — multi-shot enrollment is load-bearing.** With **single-frontal** enrollment, even
  modest turn (yaw≈0.3) drops recognition cosine to ~0.14 on this 1.2 M-param MIT MobileFaceNet.
  With enrollment covering **frontal + slight-turn + smiling** samples (3–5 shots), all three
  active challenges verify reliably: cos 0.79–0.86, latency ~128–141 ms, directional intent
  correctly enforced (`sat=true` only when the user turns in the prompted direction).
- **Honest pitch framing:** "Active gesture is the binding liveness signal — it defeats both
  photo and replay (the printed photo can't perform the prompted gesture; the recorded video
  can't match an unpredictable CSPRNG-picked prompt). Passive runs and we surface its score
  in `VerifyResult.passiveScore` as a transparency / extensibility hook, but it's NOT a gate
  — we measured this single MiniFASNet-V2 export and it saturates on both live and 2D inputs
  from this device's camera distribution; in production we'd swap or fuse two passive models
  per Silent-Face's upstream design without touching the FaceAuth contract."
- **Status:** Slice 2 functionally complete. Slice 5 gallery accuracy + Android validation
  finalize the τ_match and any threshold drift.

## D10 — 2026-05-28 — Active-challenge randomization uses a CSPRNG (anti-replay), polyfill batched into next native build

- **Trigger:** automated security review flagged `Math.random()` in `randomChallenge()` (HIGH, weak crypto primitive).
- **Why it's valid (not just hygiene):** the randomized active challenge IS the anti-replay mechanism (§5.2). A predictable RNG lets an attacker pre-position a recorded gesture before the prompt → replay defeats liveness. CSPRNG → unpredictable → the attacker must react in real time, which a pre-recorded video can't. The reviewer's entropy point is also valid: 3 challenges ≈ 1.58 bits.
- **Decision:**
  1. `secureRandomInt()` uses **Web Crypto `getRandomValues`** when present, Math.random only as fallback. Web Crypto isn't in Hermes by default; the **`react-native-get-random-values` polyfill** (native) will be added and **batched into the next dev-client rebuild together with MMKV (Slice 3 storage)** — both need a native build, so we don't trigger a ~15-min device rebuild twice. Until then the code path is correct and degrades gracefully.
  2. Added `randomChallengeSequence(n)` — requiring a short sequence (n=2 → ~3.17 bits, blind-guess ≈ 11%) raises the replay bar and is a stronger pitch claim.
- **Status:** code done; **CSPRNG polyfill installed and active on-device** (`react-native-get-random-values` shipped in the 2026-05-28 dev-client rebuild that also delivered encrypted MMKV gallery and expo-haptics).

## D9 — 2026-05-27 — Native pipeline architecture: VC5 + fast-opencv + ORT-RN (no custom native for v1); detection via ORT-decoded YuNet — set by Spike B findings

- **Spike B findings (confirmed this session):**
  - Modern stack is **Vision Camera 5.0.11** (Nitro-based; **no `app.plugin.js`** — do NOT list it under Expo `plugins`; permissions go via `ios.infoPlist`/Android perms; it autolinks). `react-native-worklets` 0.9.1 supports RN 0.83–0.86.
  - **pnpm needs `node-linker=hoisted`** (`.npmrc`) or RN module resolution breaks (VC5's internal ESM import failed under isolated node_modules).
  - **`react-native-fast-opencv` 0.4.8 (MIT)** exposes `warpAffine`, `resize`, `cvtColor`, Mat ops — but **NOT** `FaceDetectorYN`/objdetect/dnn, nor `estimateAffinePartial2D`/`getAffineTransform`.
  - **The full native stack COMPILES together** — `expo prebuild` → `pod install` (122 pods: ORT + OpenCV(fast-opencv) + VisionCamera + Nitro + nitro-image on SDK 56 / RN 0.85 New Arch) → **`xcodebuild` BUILD SUCCEEDED**, producing `ios/build/.../DatalakeFaceAuth.app` (simulator, no signing). The #1 integration risk (do these link + compile together?) is **fully retired, headless**.
  - **ON-DEVICE PROOF (iPhone 17 Pro Max, 2026-05-28):** dev client built + installed (automatic signing, team Q5SXSGWTN4), and an in-app ORT self-test **loads all 3 bundled models (222 ms) and runs each on-device** (YuNet 13 ms → `[1,6400,1]`…, MiniFASNet 2 ms → `[1,3]`, MobileFaceNet 3 ms → `[1,512]`) on the default CPU EP. The offline model path works on real hardware. (iPhone timings are functional-only per §0a; C3 number comes from weak Android.)
  - **yunet.onnx has a FIXED 640×640 input** — ORT enforces it; always resize the frame to 640² before YuNet, decode in TS (`src/faceauth/yunet.ts`, verified bit-exact vs cv2).
- **Architecture options for the per-frame pipeline:**
  - **v1 (chosen first — zero custom native, fully cross-platform):** Vision Camera frame processor worklet uses **fast-opencv** for frame→Mat, color convert, the **2.7× liveness crop (BGR 80×80)**, and the **aligned recognition crop (RGB 112×112)** via `warpAffine` with a **similarity transform we compute in TS** (Umeyama from the 5 landmarks — fast-opencv lacks `estimateAffinePartial2D`). Models run via **`onnxruntime-react-native`**: **YuNet decoded in TS** (priors+decode+NMS over the multi-scale heads) at a throttled rate for detection/landmarks; **MiniFASNet + MobileFaceNet on-demand** at verify. No per-frame heavy-model JS round-trip (only small tensors; recognition/liveness are one-shot).
  - **v2 (escalate only if measured Android latency misses C3):** a custom **Nitro frame-processor plugin** (Swift/C++) owning the ORT C++ API + OpenCV `FaceDetectorYN` for true all-native per-frame inference (the spec's purest path). Higher build risk; deferred until measurements justify it.
- **Why start v1:** retires schedule risk, keeps Android port free (no platform-specific native), and the `<1 s` target is for a **single on-demand verify**, not 30 fps recognition. Optimize natively only if the weak-Android number demands it. Recorded; revisit after the Android benchmark (Slice 5).
- **Verify-path concretized (fast-opencv API confirmed from its TS defs):** single-shot, JS-thread, no worklet:
  `camera.takePhoto()` → `OpenCV.base64ToMat(photo)` (BGR) → resize 640² → `matToBuffer('uint8')` → HWC→NCHW float32 → ORT **YuNet** → `decodeYunet()` → primary face. Then **liveness:** crop 2.7× → 80² → `matToBuffer` (BGR) → /255 → ORT MiniFASNet. **recognition:** build the 2×3 `M` from `estimateSimilarityTransform()` via `bufferToMat('float32',2,3,1,…)` → `invoke('warpAffine', mat, dst, M, {112,112})` → `invoke('cvtColor', …, COLOR_BGR2RGB)` → `matToBuffer` → (x−127.5)/128 → ORT MobileFaceNet → L2-norm → cosine match. Per-frame framing feedback (face present/centered) uses a throttled frame processor producing only landmarks; the heavy models stay on-demand.
- Confirmed fast-opencv ops: `frameBufferToMat`, `bufferToMat(type,rows,cols,ch,input)`, `base64ToMat`, `matToBuffer(mat,type)→{cols,rows,channels,buffer}`, `invoke('cvtColor'|'warpAffine'|'resize', …)`. base64ToMat yields **BGR** (OpenCV-native) — matches MiniFASNet directly; cvtColor→RGB for recognition. All three preprocessing steps implemented as `warpAffine` (resize/crop/align are all affine).
- **Vision Camera 5 photo API (changed from v4):** capture via `usePhotoOutput(opts)` → `outputs={[photoOutput]}` on `<Camera>`, then `photoOutput.capturePhotoToFile(settings, callbacks) → { filePath }` (filesystem path, not file://). No `photo` prop, no ref-based `takePhoto`.
- **GOTCHA (on-device, fixed): iOS captures HEIC by default, which OpenCV's `base64ToMat`/imdecode CANNOT decode** → empty Mat → crash on the next op (`imencode !image.empty()`). Fix: `usePhotoOutput({ containerFormat: 'jpeg', qualityPrioritization: 'speed', targetResolution: {720×960} })`. Read decoded dims via `matToBuffer` (not `toJSValue`, which imencodes). This applies to the photo-capture verify path; the Android equivalent should also force JPEG.
- **Status:** v1 is the plan; supersedes the assumption in D2 that a custom Swift/Nitro plugin is needed up front. D2's Nitro-vs-proxy question is moot for v1 (no custom frame-processor plugin); it returns only if we escalate to v2.

## D8 — 2026-05-27 — Recognition model: export our own MIT MobileFaceNet (experiment) with an explicit Option-3 fallback — resolves the open part of D4

- **Why this exists:** the recognition model is the **only** C6 exposure. Detection (YuNet, MIT) and liveness (MiniFASNet-V2, Apache-2.0) are sourced, license-confirmed, and IO-verified. Nearly every high-accuracy, small, ready-ONNX face embedder traces to a research/non-commercial dataset (MS1M / WebFace) or an NC license:
  - `garavv/arcface-onnx` — license **unspecified**, provenance unstated, NHWC. **Rejected.**
  - Hailo `arcface_mobilefacenet` — zoo code MIT but **weights = deepinsight/insightface (MS1M, non-commercial)**. **Rejected (provenance).**
  - EdgeFace (Idiap) — ideal size/accuracy but **CC-BY-NC-SA-4.0 (Non-Commercial)**. **Rejected.**
  - ArcFace ResNet100 (`onnxmodelzoo`, Apache-2.0) — clean license but **260 MB**. **Rejected (size, C2).**
  - `caojingtian1216/MobileFaceNet` — **MIT**, but a 154 MB `.pt` training checkpoint, no ONNX.
- **Decision (per user, 2026-05-27): Option 1 as a measured experiment with a defined fallback.**
  1. **Export** MobileFaceNet → ONNX (~4 MB fp32; int8 ~1 MB) from an **MIT/Apache-licensed PyTorch source**, so we own a cleanly-licensed artifact. Pitch angle: *"model-agnostic 112→512 contract + we own the weights."*
  2. **Validate** on the eval gallery (§7), **especially the harsh-sun and low-light slices**; report accuracy.
  3. **If accuracy > 95% with reasonable margin → LOCK it.** Clean C6 win.
  4. **If it falls short → fall back to Option 3 explicitly:** pick the most accurate small model that fits the footprint, **document the dataset provenance honestly in `LICENSES.md`**, and accept the C6 weakness in exchange for a defensible C5.
  5. **Log the decision tree + the measured before/after numbers here and in `docs/benchmarks.md` either way.**
- **Interim:** the pipeline is built **model-agnostically** behind the `(1,3,112,112) RGB → 512-d L2-normed` contract, so the model swaps in without touching pipeline code.
- **Update 2026-05-27 — export SUCCEEDED.** Used `caojingtian1216/MobileFaceNet` (MIT). Reimplemented the canonical MobileFaceNet `nn.Module` cleanly in `harness/export_mobilefacenet.py`; `load_state_dict(strict)` matched the `backbone.*` keys exactly (1,220,914 params). Exported `models/recognition.onnx` (`[1,3,112,112]→[1,512]`, **4.80 MB fp32**). Harness sanity: same-identity cos **0.92** vs different-identity **−0.03** (**0.95 margin**), embedding L2-norm 1.000. (`xuexingyu24` was rejected — unlicensed.)
- **Total footprint now 6.77 MB (fp32) — under the ~7–8 MB target with all 3 models.**
- **Status:** PARTIALLY RESOLVED — clean MIT export works and is discriminative. **Still OPEN:** (1) int8/fp16 quantization + size/latency numbers; (2) the >95% gallery-accuracy gate across harsh-sun/low-light that decides whether we lock this or fall back (Option 3). Dataset-provenance caveat disclosed in `models/README.md` + `LICENSES.md`.

## D7 — 2026-05-27 — Package manager: pnpm

- **Options:** pnpm / bun / yarn / npm.
- **Choice:** **pnpm 10.28** (installed locally; spec §3b prefers pnpm or bun for speed).
- **Why:** pnpm is present and fast; bun is not installed and adds RN/Metro edge-case risk we don't need. Recorded so the lockfile and CI are consistent.

## D6 — 2026-05-27 — Verification harness runtime: pinned Python 3.12 venv (not system 3.14)

- **Context:** System interpreter is **Python 3.14.5**. `onnxruntime` and `opencv-python` do not yet publish wheels for 3.14, so the §6 harness cannot run on the system Python.
- **Options:** (a) pinned Python **3.12** venv via `uv`/`pyenv`; (b) write the harness in Node with `onnxruntime-node` + a JS image lib; (c) wait for 3.14 wheels (rejected — blocks us).
- **Choice:** **(a) Python 3.12 venv** for the harness, with (b) as fallback if any wheel is still missing. The spec (§6) explicitly allows "Python or Node."
- **Why:** Python has the most batteries-included path for OpenCV `FaceDetectorYN`, ONNX I/O, and quick image experiments; pinning 3.12 sidesteps the wheel gap entirely. The harness is a dev tool — its runtime has zero bearing on the shipped RN app.

## D5 — 2026-05-27 — State management: typed reducer / XState FSM, no Redux

- **Choice:** Model camera/liveness as an explicit finite state machine (`idle → searching → livenessActive → recognizing → result`) per spec §3b; Zustand for any global app state. No Redux.
- **Why:** Demo reliability depends on never getting stuck between states. An explicit FSM makes illegal transitions unrepresentable. Redux is over-engineering for a 2-week prototype.

## D4 — 2026-05-27 — Recognition quantization: int8 target, fp16 accuracy-safe fallback, eval decides — **DEVIATION (conditional) from §4.3**

- **Spec position (§4.3):** post-training **int8** is the headline compression technique.
- **Decision:** Keep int8 as the *goal* and the pitch's compression story, **but** make the final dtype an **empirical** call: quantize to int8, measure accuracy on a held-out gallery, and ship int8 only if the accuracy drop is negligible; otherwise ship **fp16**.
- **Why:** Footprint is **not** the binding constraint here. A MobileFaceNet backbone is ~4 MB fp32 / ~2 MB fp16 / ~1 MB int8 — **all three pass the 20 MB ceiling (C2) with large headroom.** The binding constraint is **accuracy > 95% (C5)**, and ArcFace-style embeddings can degrade more than expected under naïve int8 (especially per-tensor S8S8). So we optimize for the binding constraint and let measured accuracy pick the dtype. Either way we report both size + accuracy numbers on a slide, which is itself the Innovation narrative.
- **Mitigations if int8 is kept:** per-channel weight quantization, calibration on representative Indian-demographic/outdoor images, validate L2-normed cosine separation before/after.
- **Update 2026-05-28 — measured (`harness/quantize_recognition.py`):** dynamic **int8 = 1.36 MB (−72%)**, **fp16 = 2.42 MB (−50%, bit-identical accuracy)**. On sample faces int8 keeps the separation margin (0.892 vs fp32 0.948; same-id 0.897 / diff-id 0.004) — fully discriminative, self-consistent (enroll+verify both int8). fp16 is a zero-loss safe fallback. Totals: **int8 build 3.33 MB**, fp16 build 4.39 MB (all 3 models).
- **Lock 2026-05-28 — int8 IS the shipped dtype.** Re-ran the harness against the locked model; numbers held: same-id **0.8966**, diff-id **0.0045**, **margin 0.8921**. That margin is >2× any reasonable `τ_match` (~0.4–0.5) — accuracy is preserved with comfortable headroom. **Bundled `assets/models/recognition.onnx` now points at the 1.36 MB int8 file**; app footprint headline is **3.33 MB total**. Drift vs fp32 = 0.7956 (the int8 embedding space is shifted from fp32, expected from per-tensor dynamic quantization) — irrelevant because the entire pipeline is int8 end-to-end (enrollment + verify both int8). **fp16 stays as the bit-identical safe fallback** in `models/recognition.fp16.onnx`; swap is a one-file replacement if the Slice 5 gallery eval surfaces a real-world drop.
- **Status:** **RESOLVED — int8 locked & shipped.** fp16 fallback retained. Gallery eval at Slice 5 will validate the lock against real demographic/lighting variance; if it ever fails, replace `assets/models/recognition.onnx` with the fp16 file and rebuild. Numbers in `docs/benchmarks.md`.

## D3 — 2026-05-27 — Active-liveness challenge set: head-turn + smile + mouth-open; blink deferred — **DEVIATION from §5.1**

- **Spec position (§5.1):** active challenges include **blink-twice via Eye-Aspect-Ratio (EAR)**.
- **Problem:** YuNet (`FaceDetectorYN`) returns only **5 landmarks** — right eye *center*, left eye *center*, nose tip, right mouth corner, left mouth corner. **EAR requires upper/lower eyelid contour points**, which YuNet does not provide. The §5.1 EAR recipe is therefore **not computable** from the detector we use; implementing it as written would silently never trigger.
- **Options:**
  - (a) Ship challenges computable from 5 landmarks + bbox: **head-turn-left, head-turn-right, smile (mouth-corner spread normalized by interocular distance), mouth-open** — randomized per verify.
  - (b) Add a face-mesh model (e.g. MediaPipe Face Landmarker, 468 pts) to enable true EAR blink — costs +2–3 MB and a second native runtime/dependency, complicating the "single ORT engine" story.
  - (c) Add a tiny dedicated eye-open/closed classifier for blink.
- **Choice:** **(a)** as the shipped default. Blink becomes a **stretch goal** only if (b) is later justified.
- **Why:** The brief's deliverable 1a requires the user to "**blink, smile, or turn their head slightly**" — **smile + head-turn fully satisfies it**. Option (a) keeps us **ORT-only, footprint-tiny, and dependency-light**, and randomizing among 3–4 challenges still defeats pre-recorded replay (the actual security goal). Paying a 2–3 MB model purely to enable blink would erode the footprint headline (C2/Innovation) for no rubric gain.
- **Security note:** The fusion rule (passive MiniFASNet AND a randomized active challenge within a time window) is unchanged; the differentiator survives intact.
- **Update 2026-05-28 (implementation):** dropped **mouthOpen** too — the 5 landmarks are 2 eye centers + nose + 2 mouth *corners*, with no lip-contour points, so vertical mouth opening isn't measurable. Shipped active set = **headLeft / headRight / smile** (`src/faceauth/activeLiveness.ts`: yaw = nose offset from eye-midpoint / interocular; smile = mouth-corner spread / interocular). Thresholds + front-camera yaw sign are tuned on-device. `ActiveChallenge` type updated in `types.ts`.

## D2 — 2026-05-27 — Frame-processor wiring: Nitro Modules by default, proxy fallback gated by the Day-0 spike

- **Options (per §3a.4):** (a) Vision Camera **Nitro Modules** frame-processor plugin (define a TS `HybridObject`, run nitrogen, implement `call(frame)` in Swift); (b) legacy `VisionCameraProxy.initFrameProcessorPlugin('faceAuthProcess')` + `plugin.call(frame)`.
- **Choice:** **(a) Nitro by default** (more future-proof, spec-preferred), **but explicitly gated** behind the Day-0 native toolchain spike. If Nitro + ONNX Runtime + OpenCV on the New Architecture shows integration friction that threatens the timeline, fall back to **(b)**, which is proven and battle-tested.
- **Why:** Don't bet the longest-pole integration on the newest path without a smoke test. Whichever survives the spike is the recorded decision.
- **Status:** OPEN — resolved by the Day-0 spike.

## D1 — 2026-05-27 — App architecture: Expo dev-build + CNG + local Expo module (confirmed, not a deviation)

- **Choice:** Latest Expo SDK with **development build** (not Expo Go), **Continuous Native Generation** via `expo prebuild`, custom native code in a **local Expo module** (`npx create-expo-module --local`), RN **New Architecture** enabled, config plugins for all native deps (Vision Camera, worklets-core, OpenCV pod, ORT pod).
- **Why:** Per spec §3a — this is the only setup where Vision Camera frame processors (which need custom native code + New Arch) work while retaining Expo DX and a reproducible iOS-today / Android-later prebuild. Expo Go cannot load custom native modules; hand-edited `ios/` is not the source of truth.
- **Confirmed against local toolchain:** Xcode 26.5 + iOS 26.5 runtime (real Liquid Glass available), CocoaPods 1.15.2, EAS 19.1.0, pnpm 10.28 — all present.
