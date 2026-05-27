# CLAUDE.md — Offline Facial Recognition & Liveness Detection (Datalake 3.0)

> **Purpose of this file.** This is the engineering specification and working brief for building a mobile, fully-offline facial recognition + liveness detection prototype in React Native for Hackathon 7.0. It is written to be read by Claude Code (or any agentic coding assistant) at the root of the repository. It defines the architecture, exact model specs, preprocessing recipes, module contracts, file layout, and acceptance criteria. Treat the **hard constraints** and **acceptance criteria** as non-negotiable; everything else is guidance you may improve on with justification.

-----

## 0. Operating instructions for the coding assistant

**Your role.** You are not a tutorial-follower and not a junior learning on the job. You are a senior engineer who has shipped production on-device ML and is here to *win this hackathon*. This document is your brief, not your cage. Where it is specific (model recipes, constraints, acceptance criteria) it encodes hard-won detail you should not casually override. But where you can see a genuinely better path — a newer library, a faster model, a cleaner architecture, a smarter liveness trick — **take it**, and record the reasoning in `DECISIONS.md`. The measure of success is a winning prototype, not fidelity to this file. Exercise judgment: improve the plan, don’t just execute it. The only things that are truly non-negotiable are the **hard constraints (§1)**, the **acceptance criteria (§11)**, the **child-of-correctness model recipes (§4)** unless you verify a better recipe empirically, and the **open-source/licensing rule (C6)**.

1. **Read this whole file before writing any code.** Then restate the build plan back in your own words, note anything you intend to do differently and why, and list the first three files you will create.
1. **Work in vertical slices.** Get one thin end-to-end path working (camera → detect → embedding → match) on **iOS** (the dev/test device, see §0a) before adding liveness, quantization, or polish. Do not build all modules in isolation and integrate at the end.
1. **Never invent model behavior.** The preprocessing recipes in §4 are exact and load-bearing. A wrong crop margin, color order (BGR vs RGB), or normalization will silently destroy accuracy with no error thrown. When in doubt, write a verification harness that runs the model on a known input and checks the output range. If you find a recipe that empirically beats the one here, adopt it and document the before/after numbers.
1. **Prefer existing, permissively-licensed building blocks** over hand-rolled native code. The reference repos in §9 exist; study them. But keep the final code clean and owned by us.
1. **Every third-party artifact must be logged in `LICENSES.md`** with its license. The competition mandates open-source-only with no additional licensing required. If a dependency is not clearly permissive (MIT/Apache-2.0/BSD), flag it and propose an alternative instead of using it.
1. **When you hit a decision the spec doesn’t cover — or decide to deviate from it — state the options, pick one, and note why** in a `DECISIONS.md` log. Don’t silently choose, and don’t silently follow if you believe the spec is wrong.
1. **Beware the dev-vs-grading hardware gap (critical — read §0a).** Development and testing happen on an **iPhone 17 Pro Max**, but the brief is graded against a **mid-range Android phone with 3 GB RAM** in airplane mode. Latency measured on the iPhone proves the code is *correct*, not that constraint C3 (<1 s) is *met*. Optimize the pipeline as if it must run on the weak Android device, and never quote an iPhone latency number as evidence the constraint is satisfied.
1. **TypeScript everywhere, strict.** See §3b. No `any` in committed code without a justified, commented exception.
1. **The UI is graded too (20 marks) and is the judge’s first impression.** Build the iOS 26 liquid-glass, light-theme design in §3c to a polished, native-feeling standard — not a rough approximation.

-----

## 0a. Platform strategy: iOS-first, Android-graded

- **Primary dev/test target:** iPhone 17 Pro Max (the only physical device available during development). Build, run, and iterate here for fast feedback.
- **Codebase is cross-platform by construction:** React Native + ONNX Runtime Mobile + OpenCV all run identically on both platforms. Keep ALL business logic, preprocessing, model I/O, matching, liveness, and storage in shared TS + a shared native-plugin core so the Android port is a build/packaging task, not a rewrite. Do not let iOS-only assumptions (paths, threading quirks, CoreML-specific code) leak into shared logic.
- **The hardware gap is a real scoring risk, not a footnote.** The 17 Pro Max has a top-tier Neural Engine; this pipeline will run far under 1 s on it regardless of how unoptimized it is. That makes its latency numbers useless for proving C3/C4. Treat iPhone results as a *functional* check (“the pipeline produces correct output”) and explicitly NOT as a *performance* check against the rubric.
- **Plan for one real performance validation on weak hardware before submission.** Acquire (or borrow) a real ~3 GB-RAM Android device, or at minimum a deliberately throttled mid-range Android target, and capture the defensible <1 s benchmark there. This is the number that goes in `docs/benchmarks.md` and on the slide — the iPhone number does not count.
- **ONNX Runtime execution providers:** on iOS, ORT can use the CoreML execution provider; on Android, NNAPI/XNNPACK. Keep EP selection behind a small platform-agnostic config so swapping providers per platform doesn’t touch the pipeline code. Do NOT hard-code CoreML into the inference path.
- **Demo plan:** live demo on the iPhone (smooth, reliable, your device); present the Android <1 s + memory numbers from the validation run as the rubric-relevant performance evidence, and argue cross-platform parity from the shared codebase. If an Android device can be demoed too, even better, but the iPhone is the safe live-demo path.

-----

## 1. The problem (verbatim constraints)

Build a mobile-based, secure, **fully offline** facial recognition and liveness detection system for field personnel in zero-network zones, integrable into an existing React Native app (“Datalake 3.0”) on **both Android and iOS**.

### Hard constraints (these are graded)

|# |Constraint           |Target                                                                                                                   |
|--|---------------------|-------------------------------------------------------------------------------------------------------------------------|
|C1|Framework            |React Native, runs on Android **and** iOS from one codebase                                                              |
|C2|Total model footprint|~20 MB ceiling; **smaller is explicitly better**                                                                         |
|C3|End-to-end latency   |Recognize face + verify liveness in **< 1 second** on mid-range device                                                   |
|C4|Hardware floor       |No high-end GPU; Android 8.0+ / iOS 12+; **3 GB RAM minimum**                                                            |
|C5|Accuracy             |Face recognition **> 95%**; robust across diverse Indian demographics and outdoor lighting (harsh sun, low light, shadow)|
|C6|Licensing            |**Open-source only**; share full source; no additional licenses required                                                 |
|C7|Liveness             |Offline anti-spoofing that defeats photo/screen replay attacks                                                           |
|C8|Sync/purge           |Scope for syncing records to a server once online, then **purging local data**                                           |

### What “win” looks like

Beat the footprint target with obvious headroom (~7–8 MB), demonstrably hit <1 s on weak hardware, and present a liveness flow that defeats both a printed photo **and** a replayed video. The integration and sync are demonstrated via clean contracts and a fully-working local side, not a live cloud backend.

-----

## 2. Architecture overview

Three small models behind **one ONNX Runtime**, invoked from a Vision Camera frame processor, exposed to the JS layer as a single `FaceAuth` module.

```
React Native (JS/TS)
  └── <CameraScreen> uses react-native-vision-camera
        └── useFrameProcessor (worklet)  ── runs at throttled FPS ──┐
                                                                    ▼
  Native FrameProcessorPlugin  ("faceAuthProcess")
        │  receives the camera Frame (YUV/BGRA buffer)
        │  converts to an OpenCV Mat (BGR)
        ▼
  [1] DETECT   YuNet (OpenCV FaceDetectorYN)      → bbox + 5 landmarks
        │
        ├── if no face / too small / off-center → return {state:"searching"}
        │
        ▼
  [2] LIVENESS-PASSIVE  MiniFASNet-V2 (ONNX)      → real / print / replay
        │     crop 2.7× margin around bbox, 80×80, BGR, /255, NCHW
        │     livenessScore = 1 - (p_print + p_replay)
        │
        ▼
  [3] RECOGNIZE  MobileFaceNet/ArcFace (ONNX,int8)→ 512-d embedding
        │     align to 112×112 using 5 landmarks, RGB, normalize, NCHW
        ▼
  return to JS: { bbox, landmarks, livenessScore, embedding[512] }

JS layer then:
  • LIVENESS-ACTIVE: tracks landmark geometry across frames to verify a
    randomized challenge (blink / head-turn / smile)
  • MATCH: cosine similarity of embedding vs local gallery
  • FUSION: pass iff passiveScore > τ_live AND active challenge completed
  • STORE: encrypted local embeddings; SYNC/PURGE queue
```

**Footprint budget (state this on a slide):**

|Component                               |Approx size                |
|----------------------------------------|---------------------------|
|YuNet detector                          |~0.3 MB                    |
|MiniFASNet-V2 (passive liveness)        |~1.8 MB                    |
|MobileFaceNet/ArcFace int8 (recognition)|~4–5 MB                    |
|**Total models**                        |**~7–8 MB** vs 20 MB target|

-----

## 3. Technology stack (all open-source, permissive)

- **Expo (latest SDK)** with a **development build** (NOT Expo Go) and **Continuous Native Generation**. See §3a — this is a load-bearing setup detail, get it right before writing native code.
- **React Native** (the version pinned by the chosen Expo SDK), **New Architecture (Fabric + JSI) enabled** — required for Vision Camera frame processors.
- **react-native-vision-camera** v4+ — camera + custom frame processors. Has an Expo config plugin. License: MIT.
- **react-native-worklets-core** — required for frame-processor worklets; add its babel plugin.
- **ONNX Runtime Mobile** — single inference engine for all three models. Use the native ORT API inside the frame-processor plugin, **not** a JS round-trip per frame (too slow). On iOS the plugin is Swift/Objective-C++ calling the ORT Objective-C API; on Android it is Kotlin/C++ calling the ORT Java/C API. Keep the inference core platform-agnostic (shared C++ is ideal) so the iOS plugin written first ports cleanly. License: MIT.
- **OpenCV** (mobile build) — frame→Mat conversion, YuNet detector (`FaceDetectorYN`), affine warp for face alignment. On iOS, add via CocoaPods (`opencv2` framework). License: Apache-2.0.
- **Storage:** encrypted key-value store for embeddings (e.g. MMKV with encryption, or SQLCipher if a relational store is preferred). Store **embeddings, never raw face images.**
- **No hosted/commercial face SDKs** (e.g. FacePlugin, Banuba). They violate C6. Do not use them even if a tutorial suggests them.

> Platform note: the heavy per-frame work (3 model inferences + OpenCV) must run in the **native frame processor**, off the JS thread. JS only receives the small result object and runs the cheap active-liveness geometry + matching.

> **iOS-first build note:** the iOS frame-processor plugin receives the camera frame as a `CMSampleBuffer` (typically YUV/BGRA). Convert it to a BGR OpenCV `Mat` once per frame, then derive the two model-specific crops from that Mat (BGR 80×80 for MiniFASNet; aligned RGB 112×112 for recognition). Bundle the three `.onnx` files in the app target and load them by path from the main bundle. Use the ORT **CoreML execution provider** if it helps, but keep EP selection behind config (see §0a) so Android can swap to NNAPI/XNNPACK without touching pipeline code.

-----

## 3a. Expo setup (READ FIRST — wrong choice here costs days)

We use the **latest Expo SDK**, but **not** the classic managed / Expo Go workflow. The entire app depends on custom native code (a Vision Camera frame processor linking ONNX Runtime + OpenCV), and **Expo Go cannot load custom native modules**. Anyone who tries to test the pipeline in Expo Go will hit confusing failures. The correct, current (2026) setup:

1. **Development build, not Expo Go.** Install `expo-dev-client` and build a custom dev client. Vision Camera frame processors require leaving Expo Go and require the **New Architecture**. Run on the iPhone 17 Pro Max via this dev build.
1. **Continuous Native Generation (CNG) via `expo prebuild`.** Keep the Expo DX (expo-router, expo modules, EAS Build, OTA) but generate the native `ios/` project from config. Do **not** hand-edit the Xcode project as the source of truth — express native changes as config so `prebuild` is reproducible and the later Android port is `prebuild` + build, not rework.
1. **Use a local Expo Module for our custom native code.** Per Expo’s current guidance, custom native code for a single app should be a **local Expo module** (`npx create-expo-module --local`), which scaffolds Swift (iOS) + Kotlin (Android) and auto-links. This is where the ONNX Runtime + OpenCV inference core and the Vision Camera frame-processor plugin live.
1. **Frame-processor plugin wiring.** Vision Camera’s newest path uses **Nitro Modules** for native frame-processor plugins (define a TS `HybridObject` spec, run nitrogen, implement `call(frame)` in Swift, unwrap the `CMSampleBuffer` there). The older `VisionCameraProxy.initFrameProcessorPlugin('faceAuthProcess')` + `plugin.call(frame)` pattern also works. Pick one, record it in `DECISIONS.md`; Nitro is the more future-proof choice.
1. **Config plugins for native deps.** Vision Camera and worklets-core ship Expo config plugins — add them to `app.json`/`app.config.ts` (camera permission strings, New Arch flag, worklets babel plugin). For OpenCV (CocoaPods `opencv2`) and the ORT pod, either add them inside the local module’s podspec or write a tiny custom config plugin so `prebuild` injects them. Never rely on a manual `pod install` edit that `prebuild` will wipe.
1. **EAS Build** for producing the dev build and the final submission build, so the build is reproducible off your machine too.

> Bottom line for the assistant: Expo here is “bare-workflow power with managed-workflow DX.” Everything native goes through config plugins + a local Expo module so `expo prebuild` regenerates iOS today and Android later from the same source. Do not introduce any step that only works by manually editing generated native folders.

> **Things that will NOT work and should never be attempted:** testing the frame processor in Expo Go; using `expo-camera` for the pipeline (it does not expose raw frames to native — Vision Camera is required); treating hand-edited `ios/` files as the source of truth.

-----

## 3b. TypeScript & code quality

- **TypeScript, strict mode.** `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. No `any` in committed code without a commented justification.
- **Typed boundaries.** The native module’s JS interface, the `FaceAuth` API (§8), the camera result object, and the storage schema are all explicitly typed. The result returned from the native frame processor must have a single source-of-truth TS type shared by native bridge and JS consumers.
- **Tooling:** ESLint + Prettier + `tsc --noEmit` in CI (or a pre-commit hook). Use the project’s package manager consistently (prefer `pnpm` or `bun` for speed; record the choice).
- **State management:** keep it light — Zustand or React context is plenty; do not pull in Redux. Camera/liveness state is a small finite state machine (`idle → searching → livenessActive → recognizing → result`); model it explicitly, ideally with XState or a typed reducer, because demo reliability depends on never getting stuck between states.
- **No dead frameworks / no over-engineering.** Best technology means *appropriate* technology: latest Expo SDK, latest stable RN with New Arch, Reanimated 3 for animation, the liquid-glass libs in §3c. Don’t add anything that isn’t earning its place in a 2-week winning prototype.

-----

## 3c. UI/UX — iOS 26 Liquid Glass, LIGHT THEME ONLY

The interface must look like a native iOS 26 app using **Liquid Glass**, in a **light theme only** (no dark mode — do not implement a theme switcher; lock to light). This is your first-impression surface and part of the 20 Presentation marks. The iPhone 17 Pro Max runs iOS 26, so the *real* native glass material renders — use it, don’t fake it with hand-rolled blur.

### Libraries (Expo SDK 54+, all fall back gracefully and none work in Expo Go)

- **`expo-glass-effect`** — the primary choice. Provides `<GlassView>` backed by `UIVisualEffectView`; props for glass style and tint. Renders real glass on iOS 26+, falls back to a plain `View` below. This is the simplest path for cards, panels, and overlays.
- **`@expo/ui/swift-ui`** — for true SwiftUI glass with morphing: exposes `glassEffect({ glass: { variant: 'regular' } })` and `glassEffectID` + `Namespace` modifiers, and `GlassEffectContainer` semantics where overlapping glass elements **morph into one shape**. Use for the signature moments (e.g. the liveness prompt chip morphing into the result badge).
- **`@callstack/liquid-glass`** — Fabric/TurboModule alternative exposing `isLiquidGlassSupported` and an interactive glass view. Keep as fallback if an Expo-native path has gaps. Requires RN 0.80+ and Xcode 26.

Pick `expo-glass-effect` + `@expo/ui` as the default pairing; record any switch in `DECISIONS.md`.

### Light-theme glass design tokens (define once, reuse — do not scatter magic values)

- **Background:** a soft, bright, slightly warm light backdrop (e.g. near-white with a faint cool/warm gradient or a subtle blurred brand image) so the glass has something luminous to refract. Pure flat white kills the effect — glass needs gentle underlying variation to read as glass.
- **Glass surfaces:** `regular` variant for primary panels; `clear` for lightweight overlays. Light tint, low saturation. Rounded continuous corners (≈20–28 px), generous padding (≈16–20 px).
- **Typography:** SF Pro / system font. Text on glass gets vibrant treatment automatically — keep high contrast (dark text on light glass), avoid low-contrast gray-on-glass. Verify legibility over the brightest part of the background.
- **Accent:** one restrained accent color for primary actions and the “verified” success state; semantic green for pass, amber/red for liveness-fail or no-match. Keep accents off the glass tint itself.
- **Motion:** Reanimated 3; use the glass libs’ built-in `animate`/`animationDuration` for fade in/out (NOT opacity on the GlassView — setting opacity to 0 breaks the glass render; this is a documented gotcha). Subtle spring on state transitions.
- **Haptics:** light impact on liveness-challenge success and on match — cheap polish that reads as native quality in a live demo.

### Where glass goes (screen inventory)

- **Camera screen:** full-bleed live preview; a floating **glass instruction chip** (“Blink twice”, “Turn your head left”) and a glass status pill (searching / checking liveness / recognizing). A glass-framed face guide oval.
- **Result:** a glass card sliding up with the matched identity, confidence, liveness-passed badge, and latency. Success haptic + accent.
- **Register / Verify / Admin(purge):** glass list rows and glass primary buttons. Native tab bar via Expo Router’s native tabs (system Liquid Glass tab bar) if used.

### Glass pitfalls (documented — avoid)

- **Don’t double-blur:** a native header/tab blur plus a custom glass child layers into mud. Use a plain translucent view for header accessories, real glass for content panels.
- **Don’t over-customize:** heavy tint/border/shadow stacks on glass reduce the native feel. Lighter is more authentic.
- **Don’t animate via opacity** (see motion note). Don’t put glass over a flat solid fill — give it texture/gradient to refract.
- **Always provide the fallback look:** since these libs degrade to plain `View` off iOS 26, make sure the light-theme layout still looks clean as plain cards (matters for the Android port and any non-26 device).

-----

## 4. Model specifications & preprocessing (EXACT — do not improvise)

### 4.1 Detection — YuNet (OpenCV `FaceDetectorYN`)

- Ships with OpenCV; tiny (~300 KB). Outputs bounding box + 5 facial landmarks (right eye, left eye, nose tip, right mouth corner, left mouth corner) + score.
- Run on a downscaled frame (e.g. longest side ≈ 320–640 px) for speed; scale coordinates back up.
- Gate before proceeding: require score above threshold, face box above a minimum pixel size, and face reasonably centered. Otherwise return `{state:"searching"}` to the UI.

### 4.2 Passive liveness — MiniFASNet-V2 (Silent-Face-Anti-Spoofing)

Source: `minivision-ai/Silent-Face-Anti-Spoofing`; ready ONNX export: `garciafido/minifasnet-v2-anti-spoofing-onnx`.

- **Input shape:** `(1, 3, 80, 80)`, float32.
- **Color order:** **BGR** (OpenCV-native; do NOT convert to RGB).
- **Crop:** take the detector bbox, expand by **2.7× scale margin around the bbox center** (matches the upstream `2.7_80x80` recipe), then resize to 80×80. No alignment warp for this model.
- **Normalize:** `pixel / 255.0` → range [0, 1].
- **Layout:** HWC → NCHW.
- **Output:** 3-class logits → softmax → `[p_real, p_print, p_replay]`.
- **Liveness score:** `livenessScore = 1 - (p_print + p_replay)` (equivalently `p_real`). Default pass threshold `τ_live ≈ 0.7`; tune on real outdoor data (§7).

> This is the “silent” layer: catches a static photo or screen with no user action. Cheap (~1.8 MB, a few ms).

### 4.3 Recognition — MobileFaceNet / ArcFace embedding (int8)

Reference exports: `garavv/arcface-onnx` (112×112 in, 512-d out) for the recipe; a MobileFaceNet backbone keeps size/latency far lower than ResNet100. Prefer a MobileFaceNet-class model quantized to int8; fall back to a small ArcFace export if needed.

- **Input shape:** `(1, 3, 112, 112)`, float32.
- **Color order:** **RGB** (note: different from MiniFASNet — get this right).
- **Alignment:** warp the face to canonical 112×112 using the **5 landmarks** from YuNet via a similarity transform (standard ArcFace reference points). Alignment materially improves accuracy across pose — do not skip it.
- **Normalize:** standard ArcFace normalization `(pixel - 127.5) / 128.0` → range ≈ [-1, 1]. (Verify against the specific export you download; some use `/255`. Confirm with the verification harness in §6.)
- **Layout:** HWC → NCHW.
- **Output:** 512-d embedding. **L2-normalize** the embedding before storing/comparing.
- **Quantization:** post-training **int8** (ORT dynamic or static quantization; S8S8 QDQ is the default and balances accuracy/perf). This is the headline compression technique — measure size and latency before/after and put both numbers on a slide. Validate that accuracy on a held-out set drops negligibly.

### 4.4 Matching

- Compare two L2-normalized 512-d embeddings by **cosine similarity** (= dot product after L2-norm).
- A person is registered with one or more enrollment embeddings; at verify time, take the max similarity across that person’s stored embeddings.
- **Match threshold `τ_match`** tuned on real data (§7); typical starting point ≈ 0.4–0.5 for cosine on ArcFace-style embeddings. Report the threshold and the resulting accuracy.

-----

## 5. Liveness design (the differentiator — build both layers)

Most competing teams will do **only** active challenges. We do passive + active and **fuse** them.

### 5.1 Active challenge-response (JS-side, landmark geometry)

At verify time, randomly pick ONE challenge from `{blink-twice, turn-head-left, turn-head-right, smile}` and prompt the user. Randomization defeats pre-recorded replays. Verify via geometry on the per-frame landmarks:

- **Blink:** Eye Aspect Ratio (EAR) drops below a threshold then recovers, twice within a time window.
- **Head turn:** estimate yaw from horizontal displacement/asymmetry of eye & nose landmarks; require it to cross a threshold in the prompted direction.
- **Smile:** Mouth Aspect Ratio (MAR) / mouth-corner spread increases past a threshold.
  Each challenge must complete within `N` seconds (e.g. 5 s) or it fails.

### 5.2 Fusion rule (put this exact sentence in the pitch)

> **Pass liveness iff** `passiveScore > τ_live` on the captured frames **AND** the randomized active challenge is completed within the time window.

This is the single most defensible “innovation” claim and it is cheap to build. Passive catches photos/screens with zero user effort; active defeats sophisticated replay; randomization defeats pre-recorded replay of the challenge itself.

-----

## 6. Verification harness (build this early, it saves days)

Before wiring anything into RN, create a desktop/Python (or Node) harness that:

1. Loads each ONNX model and prints input/output names, shapes, dtypes.
1. Runs each model on a known sample image and asserts output ranges are sane (softmax sums to 1 for MiniFASNet; embedding L2-norm ≈ 1 after normalization for recognition).
1. Verifies the **full pipeline** on a webcam/sample: detect → passive liveness → embedding, and prints scores.
1. Confirms a printed photo of a face yields a **low** passive liveness score and a live face yields a **high** one.

Only after this passes should the same recipes be ported into the native frame processor. A silent preprocessing bug (wrong color order / crop / normalization) is the #1 cause of “the model runs but accuracy is garbage” — the harness catches it.

-----

## 7. Robustness & accuracy plan (C5)

- Build a small internal evaluation gallery captured on the **target device**, spanning: harsh sunlight, low light, shadow, indoor; multiple subjects across skin tones; with/without glasses; varied head poses.
- Tune `τ_live` and `τ_match` against this gallery. Record: true-accept rate, false-accept rate, false-reject rate, and overall accuracy. Show a table.
- Multi-shot enrollment: store 3–5 embeddings per person from slightly varied poses/lighting; match against the best. This is the cheapest large accuracy gain.
- If outdoor false-rejects are high, the active challenge is the backstop — never let passive-only block a real user.

-----

## 8. `FaceAuth` module contract (this IS the Datalake integration story)

Expose a single, clean, documented JS/TS API. In the pitch, show this surface and state: “this is the contract Datalake 3.0 calls.” A clean interface IS the integration deliverable; we do not need the real Datalake app.

```ts
type VerifyResult = {
  matched: boolean;
  personId: string | null;
  confidence: number;        // cosine similarity of best match
  livenessPassed: boolean;
  passiveScore: number;
  activeChallenge: 'blink' | 'headLeft' | 'headRight' | 'smile';
  latencyMs: number;         // end-to-end, for the <1s claim
};

const FaceAuth = {
  // Enroll a person from N guided captures; stores L2-normalized embeddings locally (encrypted).
  register(personId: string): Promise<{ ok: boolean; samples: number }>,

  // Run the full pipeline: detect → passive liveness → randomized active challenge → embed → match.
  verify(): Promise<VerifyResult>,

  // Local gallery management
  listEnrolled(): Promise<string[]>,
  deletePerson(personId: string): Promise<boolean>,

  // Sync & purge (C8) — see §10
  queueForSync(record: VerificationRecord): Promise<void>,
  syncNow(): Promise<{ synced: number }>,   // mock cloud drain; logs what WOULD be sent
  purgeLocal(): Promise<{ purged: number }> // wipes embeddings + logs; demonstrate live
};
```

-----

## 9. Repository layout & references

### Proposed layout

```
/CLAUDE.md                     ← this file
/LICENSES.md                   ← every dependency + license (mandatory, C6)
/DECISIONS.md                  ← running log of non-obvious choices
/README.md                     ← setup + integration guide (graded, §11)
/app.config.ts                 ← Expo config: plugins, permissions, New Arch flag (§3a)
/docs/
  architecture.md              ← diagram + data flow
  benchmarks.md                ← size/latency/accuracy tables
  integration-guide.md         ← how Datalake 3.0 wires in FaceAuth
/models/                       ← the 3 .onnx files (+ a note on provenance)
/harness/                      ← §6 verification harness (Python or Node)
/modules/face-auth/            ← LOCAL EXPO MODULE: native frame-processor plugin
                                  (Swift/iOS + Kotlin/Android), ORT + OpenCV core,
                                  podspec pulling opencv2 + onnxruntime (§3a)
/plugins/                      ← custom Expo config plugin(s) for native deps if needed
/src/
  screens/                     ← Camera, Register, Verify, Admin(purge)
  faceauth/                    ← JS API (§8), active-liveness geometry, matching, storage
  sync/                        ← queue + mock cloud + purge (§10)
/ios/ /android/                ← GENERATED by `expo prebuild` — not source of truth, do not hand-edit
```

### Reference repos (study, then build clean — do NOT ship a blind fork)

- `minivision-ai/Silent-Face-Anti-Spoofing` — passive liveness source + paper (Fourier-aided MiniFASNet).
- `garciafido/minifasnet-v2-anti-spoofing-onnx` — ready ONNX + exact preprocessing recipe used in §4.2.
- `maateusx/react-native-expo-facial-recognition` — full RN + ArcFace ONNX reference (register/verify/local storage). Closest existing thing to our app; use it to de-risk the bridge.
- `garavv/arcface-onnx` — 112×112→512-d ONNX export + recipe.
- ONNX Runtime quantization docs — for the int8 step (§4.3).

-----

## 10. Sync & purge (C8) — build the local side fully, mock the cloud

- Implement a real local **queue** of `VerificationRecord`s (id, personId, timestamp, result — never raw images).
- `syncNow()` drains the queue against a **mock cloud** with simulated latency and logs exactly what would be transmitted (this stands in for the AWS sync; the contract is what matters for grading “Scalability & Sustainability”).
- `purgeLocal()` wipes all embeddings, logs, and queued records, and is **demonstrated live** in the pitch (“queue a record → purge → show local data gone”).
- Encrypt embeddings at rest. Make the security story explicit: biometric data never leaves the device unencrypted, and is purged on command.

-----

## 11. Deliverables & acceptance criteria

### Mandatory deliverables (from the brief)

1. Working cross-platform RN prototype demonstrating **offline** capability (airplane mode), including offline liveness and a sync/purge mechanism.
1. Presentation (.pptx/.pdf) + technical documentation: model architecture, integration steps, performance benchmarks.

### Acceptance criteria (definition of done)

- [ ] App runs end-to-end on the **iPhone 17 Pro Max in airplane mode**: detect → liveness (passive+active) → recognize → match. (Functional proof.)
- [ ] Total bundled models ≤ ~8 MB; size reported in `docs/benchmarks.md`.
- [ ] Measured end-to-end verify latency **< 1 s on a real ~3 GB-RAM Android device** (NOT the iPhone — see §0a); number reported. iPhone latency may be reported separately but does not satisfy C3.
- [ ] Passive liveness rejects a **printed photo**; active challenge rejects a **replayed video**; both demonstrated.
- [ ] Recognition accuracy **> 95%** on the internal gallery across lighting/demographics; table reported with thresholds.
- [ ] `FaceAuth` API (§8) implemented and documented.
- [ ] `purgeLocal()` works and is demonstrable; embeddings encrypted at rest.
- [ ] UI is iOS 26 Liquid Glass, **light theme only**, polished and native-feeling (§3c); legible over the live camera background.
- [ ] Codebase is strict TypeScript (§3b); `tsc --noEmit` and lint pass clean.
- [ ] `LICENSES.md` complete; every dependency permissive (C6).
- [ ] Android: builds from the shared codebase and runs the performance/memory validation. Live demo may be on iPhone, with cross-platform parity argued from the shared RN + ORT + OpenCV code and the Android benchmark numbers.

### Grading map (so you optimize for the right things)

|Criterion                   |Marks|Driven by                                                     |
|----------------------------|-----|--------------------------------------------------------------|
|Innovation                  |30   |~8 MB footprint, int8 quantization, dual-liveness fusion      |
|Feasibility                 |30   |Clean `FaceAuth` integration + measured <1 s on mid-range     |
|Scalability & Sustainability|20   |Sync/purge mechanism + robustness across lighting/demographics|
|Presentation & Documentation|20   |README, integration guide, benchmark tables, live demo        |

-----

## 12. Known traps (read before you debug for hours)

- **Color order mismatch:** MiniFASNet expects **BGR**, recognition expects **RGB**. Mixing these throws no error and quietly wrecks accuracy.
- **Wrong crop for MiniFASNet:** it needs the **2.7× margin** crop, not the tight detector box. Tight crop → bad liveness scores.
- **Skipping landmark alignment** before recognition → accuracy collapses on non-frontal faces.
- **Forgetting to L2-normalize** embeddings → cosine threshold becomes meaningless.
- **Running inference on the JS thread per frame** → unusable latency. Inference belongs in the native frame processor; throttle FPS.
- **Benchmarking on the iPhone 17 Pro Max (or an emulator)** → the <1 s claim is graded on a weak ~3 GB Android device; a flagship iPhone will pass trivially and tell you nothing about C3/C4. Always capture the rubric latency on target-class Android hardware (see §0a).
- **Letting iOS-only code leak into the shared pipeline** (CoreML-specific inference, iOS file paths, Obj-C-only types in business logic) → turns the “free” Android port into a rewrite. Keep the inference core and all preprocessing platform-agnostic.
- **Trying to test the frame processor in Expo Go** → impossible; Expo Go can’t load custom native modules. Use a dev build (§3a). This wastes the most time of any single mistake here.
- **Hand-editing generated `ios/` files** → `expo prebuild` overwrites them. Express all native config as config plugins / the local module’s podspec.
- **Using `expo-camera` instead of Vision Camera** → expo-camera does not expose raw frames to native code; the whole pipeline depends on Vision Camera frame processors.
- **A dependency with a non-permissive license** sneaking in → violates C6 outright. Check `LICENSES.md` on every add.