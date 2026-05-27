# DECISIONS.md

> Running log of non-obvious engineering choices, especially deviations from `CLAUDE.md`.
> Format: each entry is dated, states the options, the choice, and the reasoning. Newest first.
> The spec (`CLAUDE.md`) is the brief, not the cage — but every departure from it is recorded here with justification, per §0 of the spec.

---

## D9 — 2026-05-27 — Native pipeline architecture: VC5 + fast-opencv + ORT-RN (no custom native for v1); detection via ORT-decoded YuNet — set by Spike B findings

- **Spike B findings (confirmed this session):**
  - Modern stack is **Vision Camera 5.0.11** (Nitro-based; **no `app.plugin.js`** — do NOT list it under Expo `plugins`; permissions go via `ios.infoPlist`/Android perms; it autolinks). `react-native-worklets` 0.9.1 supports RN 0.83–0.86.
  - **pnpm needs `node-linker=hoisted`** (`.npmrc`) or RN module resolution breaks (VC5's internal ESM import failed under isolated node_modules).
  - **`react-native-fast-opencv` 0.4.8 (MIT)** exposes `warpAffine`, `resize`, `cvtColor`, Mat ops — but **NOT** `FaceDetectorYN`/objdetect/dnn, nor `estimateAffinePartial2D`/`getAffineTransform`.
  - **The full native stack COMPILES together** — `expo prebuild` → `pod install` (122 pods: ORT + OpenCV(fast-opencv) + VisionCamera + Nitro + nitro-image on SDK 56 / RN 0.85 New Arch) → **`xcodebuild` BUILD SUCCEEDED**, producing `ios/build/.../DatalakeFaceAuth.app` (simulator, no signing). The #1 integration risk (do these link + compile together?) is **fully retired, headless**. Remaining on-device proof (frame-processor round-trip with live camera) needs the physical iPhone + signing → folds into Slice 1.
- **Architecture options for the per-frame pipeline:**
  - **v1 (chosen first — zero custom native, fully cross-platform):** Vision Camera frame processor worklet uses **fast-opencv** for frame→Mat, color convert, the **2.7× liveness crop (BGR 80×80)**, and the **aligned recognition crop (RGB 112×112)** via `warpAffine` with a **similarity transform we compute in TS** (Umeyama from the 5 landmarks — fast-opencv lacks `estimateAffinePartial2D`). Models run via **`onnxruntime-react-native`**: **YuNet decoded in TS** (priors+decode+NMS over the multi-scale heads) at a throttled rate for detection/landmarks; **MiniFASNet + MobileFaceNet on-demand** at verify. No per-frame heavy-model JS round-trip (only small tensors; recognition/liveness are one-shot).
  - **v2 (escalate only if measured Android latency misses C3):** a custom **Nitro frame-processor plugin** (Swift/C++) owning the ORT C++ API + OpenCV `FaceDetectorYN` for true all-native per-frame inference (the spec's purest path). Higher build risk; deferred until measurements justify it.
- **Why start v1:** retires schedule risk, keeps Android port free (no platform-specific native), and the `<1 s` target is for a **single on-demand verify**, not 30 fps recognition. Optimize natively only if the weak-Android number demands it. Recorded; revisit after the Android benchmark (Slice 5).
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
- **Status:** OPEN — resolved by the held-out eval in slice 5. Record before/after numbers in `docs/benchmarks.md`.

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

## D2 — 2026-05-27 — Frame-processor wiring: Nitro Modules by default, proxy fallback gated by the Day-0 spike

- **Options (per §3a.4):** (a) Vision Camera **Nitro Modules** frame-processor plugin (define a TS `HybridObject`, run nitrogen, implement `call(frame)` in Swift); (b) legacy `VisionCameraProxy.initFrameProcessorPlugin('faceAuthProcess')` + `plugin.call(frame)`.
- **Choice:** **(a) Nitro by default** (more future-proof, spec-preferred), **but explicitly gated** behind the Day-0 native toolchain spike. If Nitro + ONNX Runtime + OpenCV on the New Architecture shows integration friction that threatens the timeline, fall back to **(b)**, which is proven and battle-tested.
- **Why:** Don't bet the longest-pole integration on the newest path without a smoke test. Whichever survives the spike is the recorded decision.
- **Status:** OPEN — resolved by the Day-0 spike.

## D1 — 2026-05-27 — App architecture: Expo dev-build + CNG + local Expo module (confirmed, not a deviation)

- **Choice:** Latest Expo SDK with **development build** (not Expo Go), **Continuous Native Generation** via `expo prebuild`, custom native code in a **local Expo module** (`npx create-expo-module --local`), RN **New Architecture** enabled, config plugins for all native deps (Vision Camera, worklets-core, OpenCV pod, ORT pod).
- **Why:** Per spec §3a — this is the only setup where Vision Camera frame processors (which need custom native code + New Arch) work while retaining Expo DX and a reproducible iOS-today / Android-later prebuild. Expo Go cannot load custom native modules; hand-edited `ios/` is not the source of truth.
- **Confirmed against local toolchain:** Xcode 26.5 + iOS 26.5 runtime (real Liquid Glass available), CocoaPods 1.15.2, EAS 19.1.0, pnpm 10.28 — all present.
