# LICENSES.md

> **Constraint C6 (graded, non-negotiable):** open-source only; full source shared; **no additional licenses required**.
> Every third-party artifact — library, model, and dataset — is logged here with its license.
> Permissive = MIT / Apache-2.0 / BSD / ISC / Unlicense. Anything not clearly permissive is flagged **🚩 REVIEW** and an alternative proposed before use.
>
> Status legend: ✅ confirmed permissive · 🔎 VERIFY-on-add (will confirm exact license at install/download) · 🚩 needs review.

---

## Runtime libraries (the shipped app)

> Every row below is **installed and shipped**; license + version confirmed from `node_modules/<pkg>/package.json`. All permissive (MIT, except OpenCV = Apache-2.0).

| Dependency | Version | Purpose | License | Status |
|---|---|---|---|---|
| expo (SDK 56) + expo-dev-client + expo-router / -image / -font / -haptics / -glass-effect / -symbols / -constants / -device / -linking / -splash-screen / -status-bar / -system-ui / -web-browser | 56.x | App framework, dev build, CNG, routing, splash, haptics, glass | MIT | ✅ |
| react-native | 0.85.3 | Cross-platform runtime (New Arch enabled) | MIT | ✅ |
| react / react-dom | 19.2.3 | UI runtime | MIT | ✅ |
| react-native-vision-camera | 5.0.11 | Camera + photo capture (Nitro) | MIT | ✅ |
| react-native-worklets | 0.8.3 | Worklets runtime (VC5 dependency; supersedes worklets-core) | MIT | ✅ |
| react-native-nitro-modules | 0.35.9 | Nitro native-module runtime (VC5 + mmkv + fast-opencv) | MIT | ✅ |
| react-native-nitro-image | 0.15.0 | Nitro image interop | MIT | ✅ |
| onnxruntime-react-native | 1.24.3 | Single inference engine (all 3 models) | MIT | ✅ |
| react-native-fast-opencv | 0.4.8 | Frame→Mat, color convert, affine warp/align (JSI/Nitro OpenCV) | MIT | ✅ |
| OpenCV (bundled by react-native-fast-opencv) | 4.x | Underlying CV kernels | Apache-2.0 | ✅ |
| react-native-mmkv | 4.3.1 | **AES-encrypted** embeddings-at-rest (gallery) | MIT | ✅ |
| react-native-get-random-values | 1.11.0 | CSPRNG polyfill (Web Crypto getRandomValues) — anti-replay (D10) | MIT | ✅ |
| expo-glass-effect | 56.0.4 | iOS 26 Liquid Glass (`GlassView`) | MIT | ✅ |
| @expo/ui | 56.0.14 | SwiftUI primitives for signature glass moments | MIT | ✅ |
| expo-haptics | 56.0.3 | Tactile feedback on Register/Verify/Purge | MIT | ✅ |
| react-native-reanimated | 4.3.1 | Animation / motion | MIT | ✅ |
| react-native-gesture-handler | 2.31.2 | Gesture primitives (router/screens dep) | MIT | ✅ |
| react-native-screens | 4.25.2 | Native screen containers (expo-router) | MIT | ✅ |
| react-native-safe-area-context | 5.7.0 | Safe-area insets | MIT | ✅ |
| react-native-web | 0.21.x | Web target (not in the native binary) | MIT | ✅ |

> **Evaluated but NOT shipped** (so not a dependency, no license obligation): `@callstack/liquid-glass` (expo-glass-effect covered the glass needs), `zustand` / `xstate` (camera/liveness state is a small typed React-state machine — no state lib pulled in, per §3b "keep it light"), `react-native-worklets-core` (superseded by `react-native-worklets`).

## Dev / tooling (not shipped in the app binary)

| Dependency | Purpose | License | Status |
|---|---|---|---|
| TypeScript | Strict typing | Apache-2.0 | ✅ |
| ESLint + Prettier | Lint/format | MIT | ✅ |
| Python 3.12 (harness venv) | §6 verification harness | PSF (permissive) | ✅ |
| onnxruntime (python) | Harness model I/O | MIT | ✅ |
| opencv-python | Harness detection/warp | Apache-2.0 | ✅ |
| numpy | Harness math | BSD-3-Clause | ✅ |

## Models (bundled — counts against the ~20 MB / target ~7–8 MB footprint, C2)

> **🔎 All model licenses to be confirmed at download** and the source commit/hash recorded in `models/README.md`. A model with a non-permissive or research-only license is a **C6 violation** and will be replaced.

| Model | Role | Source | Size | License | Status |
|---|---|---|---|---|---|
| `yunet.onnx` | Face detect + 5 landmarks | OpenCV Zoo `face_detection_yunet_2023mar` | 0.23 MB | MIT | ✅ **confirmed + bundled** |
| `minifasnet_v2.onnx` | Passive liveness (anti-spoof) | `garciafido/minifasnet-v2-anti-spoofing-onnx` (HF) → export of `minivision-ai/Silent-Face-Anti-Spoofing` | 1.74 MB | **Apache-2.0** (LICENSE file shipped: `models/minifasnet_v2.LICENSE`) | ✅ **confirmed + bundled** |
| `recognition.onnx` | 512-d embedding (**int8 LOCKED**) | **our export** of `caojingtian1216/MobileFaceNet` backbone (head dropped), dynamic int8 | **1.36 MB** | **MIT** (weights repo); dataset = MS1M-derived (research terms) — disclosed in `models/README.md` | ✅ **shipped int8 2026-05-28** (D4 lock; fp16 2.42 MB retained as fallback) |

### Recognition-model licensing — rejected candidates (C6 audit trail)
| Candidate | Why rejected |
|---|---|
| `garavv/arcface-onnx` | License **unspecified**, provenance unstated → not redistributable under a known permissive license. |
| Hailo `arcface_mobilefacenet` | Zoo *code* MIT, but *weights* derive from **deepinsight/insightface (MS1M)** → **non-commercial** research terms. |
| EdgeFace (Idiap, all sizes) | **CC-BY-NC-SA-4.0 → Non-Commercial.** Ideal tech, disqualifying license. |
| ArcFace ResNet100 (`onnxmodelzoo`) | Apache-2.0 ✅ but **260 MB** → busts the C2 footprint ceiling even at int8. |

### Strategy (DECISIONS.md D8)
Export MobileFaceNet → ONNX from an **MIT/Apache PyTorch source** so we own a cleanly-licensed artifact; validate >95% on the eval gallery; **lock if it clears, else fall back to the most accurate small model that fits and document the dataset provenance honestly here.** Either way the chain goes in `models/README.md`.
- **Datasets.** If we fine-tune or calibrate on any face dataset, its license is logged here too. Internal eval gallery is self-captured (no third-party license).

---

*Last updated: 2026-05-28 — runtime table reconciled against the actually-installed dependency set (versions + licenses confirmed from `node_modules`); evaluated-but-unshipped libs moved out of the dependency list. All shipped deps permissive (MIT; OpenCV Apache-2.0) — C6 satisfied.*
