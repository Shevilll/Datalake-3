# LICENSES.md

> **Constraint C6 (graded, non-negotiable):** open-source only; full source shared; **no additional licenses required**.
> Every third-party artifact — library, model, and dataset — is logged here with its license.
> Permissive = MIT / Apache-2.0 / BSD / ISC / Unlicense. Anything not clearly permissive is flagged **🚩 REVIEW** and an alternative proposed before use.
>
> Status legend: ✅ confirmed permissive · 🔎 VERIFY-on-add (will confirm exact license at install/download) · 🚩 needs review.

---

## Runtime libraries (the shipped app)

| Dependency | Purpose | License | Status |
|---|---|---|---|
| Expo SDK (latest) + expo-dev-client | App framework, dev build, CNG | MIT | 🔎 confirm at install |
| React Native | Cross-platform runtime (New Arch) | MIT | ✅ |
| react-native-vision-camera (v4+) | Camera + frame processors | MIT | ✅ |
| react-native-worklets-core | Frame-processor worklets | MIT | 🔎 |
| ONNX Runtime Mobile (onnxruntime-react-native / native pods) | Single inference engine (all 3 models) | MIT | ✅ |
| OpenCV (opencv2 framework / mobile build) | Frame→Mat, YuNet `FaceDetectorYN`, affine alignment warp | Apache-2.0 | ✅ |
| react-native-mmkv (encrypted) | Encrypted embeddings-at-rest + queue | MIT | ✅ installed v4.3.x |
| react-native-get-random-values | CSPRNG polyfill (Web Crypto getRandomValues) — anti-replay (D10) | MIT | ✅ installed v1.11.x |
| expo-haptics | Tactile feedback on Register/Verify outcomes | MIT | ✅ installed v56.0.x |
| expo-glass-effect | iOS 26 Liquid Glass (`GlassView`) | MIT | 🔎 |
| @expo/ui (swift-ui) | SwiftUI glass morphing for signature moments | MIT | 🔎 |
| @callstack/liquid-glass | Glass fallback (Fabric/TurboModule) | MIT | 🔎 |
| react-native-reanimated (v3) | Animation / motion | MIT | 🔎 |
| expo-haptics | Success/match haptics | MIT | 🔎 |
| zustand | Light global state | MIT | 🔎 |
| (FSM) xstate *or* typed reducer | Camera/liveness state machine | MIT | 🔎 |

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
| `recognition.onnx` | 512-d embedding | **our export** of `caojingtian1216/MobileFaceNet` backbone (head dropped) | 4.80 MB | **MIT** (weights repo); dataset = MS1M-derived (research terms) — disclosed in `models/README.md` | ✅ exported + bundled (gallery accuracy decides final lock, D8) |

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

*Last updated: 2026-05-27 — initial inventory at project start, before first dependency install.*
