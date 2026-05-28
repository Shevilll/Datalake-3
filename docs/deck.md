---
marp: true
theme: default
paginate: true
size: 16:9
header: 'Datalake FaceAuth · Hackathon 7.0'
footer: 'Shevilll · NHAI Hackathon 7.0 · 2026'
style: |
  section {
    font-family: 'SF Pro', 'Inter', system-ui, -apple-system, sans-serif;
    background: linear-gradient(135deg, #F4F7FC 0%, #FFF5F0 100%);
    color: #0B1B33;
    padding: 56px 64px;
  }
  section.lead { text-align: center; }
  section.lead h1 { font-size: 2.2em; letter-spacing: -0.02em; }
  h1, h2, h3 { color: #0B1B33; letter-spacing: -0.01em; }
  h1 { font-size: 1.75em; }
  h2 { font-size: 1.4em; margin-top: 0; }
  strong { color: #007AFF; }
  table { font-size: 0.78em; border-collapse: collapse; }
  th { background: rgba(0,122,255,0.10); }
  th, td { padding: 6px 10px; border-bottom: 1px solid rgba(11,27,51,0.10); }
  code { background: rgba(11,27,51,0.06); padding: 1px 5px; border-radius: 4px; font-size: 0.88em; }
  pre { background: rgba(11,27,51,0.04); border-radius: 8px; padding: 12px; font-size: 0.72em; }
  blockquote { border-left: 4px solid #007AFF; padding-left: 12px; color: #48566B; font-style: italic; }
---

<!--
Datalake FaceAuth — Hackathon 7.0 Deck. Slide-by-slide content; each `---` is a slide boundary.
Convert with: `marp deck.md -o deck.pptx` (or `-o deck.pdf`) using the Marp CLI.
**Notes:** are speaker notes; **Visual:** are screenshot/illustration cues.
~12 slides, ~7–9 minute pitch.
-->

<!-- _class: lead -->

# Datalake FaceAuth

### Offline facial recognition + liveness for field personnel in zero-network zones

- Hackathon 7.0 · May 2026
- One React Native codebase · iOS + Android · 100% on-device

**One-line hook:** *Three models, **3.33 MB total**, runs entirely on-device — including liveness defense.*

**Visual:** the iOS 26 Liquid Glass app screenshot (Register/Verify panel over live camera) — already captured during development. Plus a tiny logo or wordmark.

---

## 2. The problem

NHAI field staff authenticate at remote sites with **no network**. Existing options either need the cloud (fail in zero-network zones) or use commercial face SDKs (per-seat license cost, vendor lock-in, opaque source).

**Hard constraints from the brief:**

| # | Constraint | Target |
|---|---|---|
| C1 | Cross-platform (RN, iOS + Android) | one codebase |
| C2 | Model footprint | ≤ 20 MB, smaller is better |
| C3 | End-to-end verify latency | < 1 s on mid-range device |
| C4 | Hardware floor | ~3 GB RAM, no high-end GPU |
| C5 | Accuracy | > 95% across Indian demographics + outdoor lighting |
| C6 | License | open-source only, no paid licenses |
| C7 | Liveness | offline anti-spoof (defeat photo + replay) |
| C8 | Sync / purge | queue offline → drain online → wipe local |

**Notes:** "Every constraint is graded. We deliver against each one with measured evidence, not promises."

---

## 3. Headline numbers (what we deliver)

| Constraint | Target | Our number |
|---|---|---|
| Total model footprint | ≤ 20 MB | **3.33 MB** (int8 build) — 16.5% of target |
| End-to-end verify (iPhone, functional) | — | **~130 ms** |
| End-to-end verify (rubric Android) | < 1 s | _pending Android validation_ |
| Same-identity cosine separation margin | discriminative | **0.89–0.95** (sample faces, int8/fp32) |
| On-device same-id cosine (live captures) | — | 0.79–0.86 across pose with multi-shot enrollment |
| Liveness defense | photo + replay | **CSPRNG-randomized active gesture (binding)** — defeats both; passive MiniFASNet exposed as a transparency / extensibility hook (D11) |
| Licensing | open-source only | YuNet **MIT** · MiniFASNet-V2 **Apache-2.0** · recognition **MIT** (our export) |

**Visual:** big numbers (3.33 MB, ~130 ms, 0.95) as a hero card.

**Notes:** "The footprint isn't just under the ceiling — it's a sixth of it. That's the int8 compression story."

---

## 4. Architecture in one diagram

```
        ┌────────────────────────────────────────────────────────────────┐
        │                React Native (Expo SDK 56) — TS                 │
        │                                                                │
   ┌────┴──────┐        ┌──────────────┐        ┌──────────────────┐    │
   │  Camera   │  frame │ fast-opencv  │ tensor │ ONNX Runtime     │    │
   │  (VC 5)   ├───────►│  worklet     ├───────►│ Mobile           │    │
   └───────────┘        │ (preprocess) │        │ ┌──────────────┐ │    │
                        │              │        │ │ YuNet 0.23MB │ │    │
                        │ resize ▸ crop│        │ │ MiniFASNet   │ │    │
                        │ warpAffine ▸ │        │ │   1.74MB     │ │    │
                        │ cvtColor     │        │ │ MobileFaceNet│ │    │
                        │              │        │ │  int8 1.36MB │ │    │
                        └──────────────┘        │ └──────────────┘ │    │
                                                └────────┬─────────┘    │
                                                         │ 512-d emb    │
                                                ┌────────▼─────────┐    │
                                                │   FaceAuth (§8)  │    │
                                                │  cosine match    │    │
                                                │  + active gesture│    │
                                                │  + sync / purge  │    │
                                                └──────────────────┘    │
                                                          │ VerifyResult │
                                                          ▼              │
                                                    Datalake 3.0 ◄──────┘
```

**Bullets:**
- **No custom Swift/Kotlin** in v1 — Vision Camera 5 + fast-opencv + ORT Runtime handle everything. Same RN + TS pipeline runs on both platforms.
- **One TypeScript module** (`FaceAuth`) is the public surface. Internals can swap without breaking Datalake.

**Cross-platform claim, made concrete:** every file under `src/faceauth/` (the entire pipeline — detection, alignment, embedding, matching, active liveness, gallery, sync) is **platform-agnostic TypeScript** with zero `Platform.OS` branches and no native imports. The Android port is a build artefact, not a rewrite. The one platform-specific knob is the **ONNX Runtime execution provider** — CPU EP on both today; CoreML (iOS) / NNAPI / XNNPACK (Android) can be enabled in a config swap if Slice 5 Android benchmarks need it.

**Notes:** "By not writing a Nitro plugin ourselves, we kept the toolchain simple AND we get Android for free — same TS pipeline runs on both. The platform-specific surface is one config line per build."

---

## 5. Innovation: 3.33 MB total, int8 quantization, model-agnostic architecture

| Role | Model | Size (shipped) | License |
|---|---|---|---|
| Detect + 5 landmarks | YuNet 2023-mar | **0.23 MB** | MIT (OpenCV Zoo) |
| Passive anti-spoof | MiniFASNet-V2 | **1.74 MB** | Apache-2.0 |
| Recognition (512-d) | MobileFaceNet (int8, **our MIT export**) | **1.36 MB** | MIT |
| **TOTAL** | | **3.33 MB** | all permissive ✓ C6 |

**Compression measured:**
- Recognition fp32 → int8: 4.80 MB → 1.36 MB (**−72%**), separation margin 0.89 retained.
- fp16 fallback: 2.42 MB, bit-identical accuracy.

**Visual:** a bar chart: fp32 totals stacked vs int8 totals stacked vs 20 MB ceiling.

**Notes:** "We didn't *just* hit the target. We're at a sixth of it. That gives us tons of headroom for a richer future passive-liveness model or a larger recognition head if accuracy ever needs more."

---

## 6. Innovation: anti-spoofing — CSPRNG-randomized active gesture defeats photo and replay

**The binding signal — the only thing the verdict gates on:**

A CSPRNG-randomized active gesture, picked unpredictably per verify from `headLeft` / `headRight` / `smile` (binding) + `blink` (bonus, non-binding). Geometry verified from YuNet's 5 landmarks (yaw proxy + mouth-corner spread). All three brief examples — *blink, smile, or turn their head slightly* — are surfaced.

**Fusion rule:** `verified = matched AND binding-active-challenge-satisfied`.

**What this defeats — and the live-demo plan that proves it:**

| Attack | Why it fails | Live demo |
|---|---|---|
| **Printed photo** of an enrolled subject | the photo cannot perform the prompted gesture on command — face matches, gesture fails | hold a printed photo to the camera → `Verify` → `❌ Challenge failed` on every attempt |
| **Replayed video** of the subject sitting neutrally | the recording shows no gesture; the prompt is unpredictable per verify so the attacker can't pre-position the right gesture either | play a still-frame / neutral video on a second phone → `Verify` → `❌ Challenge failed` |

**Passive MiniFASNet — exposed as a transparency / extensibility hook, NOT a binding gate.** We measured the single MiniFASNet-V2 export on real iPhone-front-camera selfies and a 2D press photo from the same pipeline: it saturates to the same score on both — it doesn't discriminate on this device's camera distribution (D11, `docs/benchmarks.md` §4). We surface the score in `VerifyResult.passiveScore` for honesty and so a production deployment can drop in a stronger model (Silent-Face's two-model fused design, or a newer export) **without changing the FaceAuth contract or any other code**. Hard-gating on this single export would lock real users out — that's not a trade we'll defend.

**Stronger replay guarantee already in the API:** `randomChallengeSequence(n)` raises per-attempt entropy to `n × log₂(3) ≈ 1.58n` bits. At `n=2` blind-guess success drops to **(1/3)² ≈ 11%** — wire when the deployment context wants it.

**Notes:** "Most teams will ship active-only and not say so, OR hard-gate on passive without ever testing whether it discriminates. We did the test, kept passive in the pipeline as a transparency hook, and made active the binding signal that actually works. The demo will show printed-photo defeat and neutral-video-replay defeat — both fail on the gesture, not on a black-box score we can't justify."

---

## 7. Feasibility: ~130 ms on-device, validated on iPhone 17 Pro Max

| Phase | Time |
|---|---|
| Photo decode (JPEG → BGR Mat) | included |
| Orientation auto-correct (try +0°, ±90°, 180°) | first hit; cached on demo |
| YuNet detect (decoded in TS) | **13 ms** |
| ArcFace-aligned MobileFaceNet embed | **3 ms** |
| MiniFASNet passive | **2 ms** |
| Cosine match against multi-shot gallery | ~0 |
| **End-to-end verify (iPhone, CPU EP)** | **~130 ms** |

**About the rubric Android number:**
Per `CLAUDE.md` §0a, **iPhone latency is a functional check only**. The C3 < 1 s number must come from a real ~3 GB-RAM Android device — pending the Slice 5 validation pass (the iPhone is the dev/test device; the architecture is platform-agnostic so it ports as a build, not a rewrite).

**Visual:** a small per-phase bar chart, with a clear callout "iPhone — functional check; Android = rubric number, pending."

**Notes:** "We're not going to claim <1 s on the flagship and pretend it's the rubric number. The honest engineering is: prove it on the iPhone, then validate on the real target. The pipeline is ready for both."

---

## 8. Feasibility: the FaceAuth integration contract (§8)

**One TypeScript module. Seven methods.** This is what Datalake 3.0 calls:

```ts
const FaceAuth = {
  register(personId: string): Promise<{ ok; samples }>,
  verify(): Promise<VerifyResult>,        // active challenge + recognition
  listEnrolled(): Promise<string[]>,
  deletePerson(personId: string): Promise<boolean>,
  queueForSync(record: VerificationRecord): Promise<void>,
  syncNow(): Promise<{ synced: number }>, // mock cloud now; drop in real POST
  purgeLocal(): Promise<{ purged: number }>,
};
```

**UI-decoupled.** Your camera screen registers ONE function (a `CaptureProvider`) that returns a captured face — FaceAuth orchestrates everything else.

**Stable contract.** Internals (model file paths, recipes, thresholds, even the model artifact itself) can swap without touching Datalake's code.

**Visual:** show the integration code snippet alongside the file pointers in `src/faceauth/FaceAuth.ts`.

**Notes:** "The integration story isn't a slide — it's typed code with a documented guide. We deliver the contract, not promises."

---

## 9. Scalability: sync queue, mock cloud, purgeLocal

```ts
await FaceAuth.queueForSync({ id, personId, timestamp, matched, confidence, livenessPassed });
// never contains raw images — embeddings + outcomes only

await FaceAuth.syncNow();    // drains to your cloud (mock POST in demo, swap for AWS)
await FaceAuth.purgeLocal(); // wipes embeddings + queue + transmit log
```

**Demo live:** queue a record → `syncNow()` shows the exact payload that *would* be POSTed (visible in Metro / device console) → `purgeLocal()` wipes the gallery; subsequent verifies return "no match" — proving local data is gone.

**On the "where's the AWS call?" question — it's mocked by design.** The brief asks for "**scope for sync with AWS server after network connectivity is restored**" (Deliverable 1b). We deliver the scope as a typed local queue + a `syncNow()` method that today drains to a mock cloud and logs the exact payload, with a one-line drop-in for the real POST. The drop-in point is documented in `docs/integration-guide.md` and called out in `src/sync/syncQueue.ts` — replace the `mockCloudUpload` call with an AWS SigV4-signed `fetch` to your endpoint and the rest of the pipeline is unchanged. **The contract is what's graded; the backend is a one-line swap.**

**Security story:**
- Biometric data **never leaves the device unencrypted**.
- **Encrypted-at-rest (MMKV, AES-128) — shipped.** Embeddings + queue persisted in an encrypted store; production would derive the key from iOS Keychain / Android Keystore (constant key in demo, noted in source).
- `purgeLocal()` is one method call away — auditable, demoable.

**Visual:** screenshot of the Metro console showing the mocked POST payload + the success haptic + the bottom-panel "Purged N local records" confirmation.

**Notes:** "Compliance asks the hard question: how do you wipe? Our answer is one function call away — and we demo it live. The AWS endpoint is a one-line swap; the contract is what we ship."

---

## 10. Robustness across lighting & demographics (Scalability)

**Multi-shot enrollment** is load-bearing: store 3–5 embeddings covering pose/expression variation, match against the **best** at verify time. We saw this on-device:

- Single frontal enrollment → cos drops to 0.14 under modest turn (yaw≈0.3).
- 3–5 multi-shot enrollment (frontal + slight turns + smile) → cos stays **0.79–0.86** across the same turn range.

**Outdoor lighting & demographics (C5):** the Slice 5 evaluation builds an internal gallery captured on-device across harsh sun / shadow / low-light / multiple skin tones / with-and-without-glasses, with reported true-accept / false-accept / false-reject / overall accuracy tables. **Threshold τ_match locks on that eval.**

**Notes:** "Multi-shot isn't a research gimmick. It's the cheapest large accuracy gain you can ship, and we showed it works on actual captures from this device."

---

## 11. Live demo

**On the iPhone (airplane-mode capable):**

1. **Register Ahmad** — capture 4–5 shots with slight pose variation (frontal, slight left, slight right, smile). Top pill shows "1 enrolled".
2. **Verify** — tap → randomized challenge prompt appears in the Liquid Glass banner ("Turn slightly LEFT", "Smile", or occasionally the bonus "Blink twice"). Perform → Capture → result panel: `✅ Ahmad — verified (cos 0.8x, ~130 ms)` + a **Success** haptic. The bonus blink prompt makes the brief's full example list — blink/smile/turn — visibly covered (D12).
3. **Defeat #1 — printed photo:** hold a printed photo of Ahmad to the camera → cosine matches the enrolled face BUT the flat photo can't perform the prompted gesture → `❌ Challenge failed`. Runs cleanly on every attempt regardless of which gesture the CSPRNG picks.
4. **Defeat #2 — replayed neutral video:** play a still-frame / neutral-sitting video of Ahmad on a second phone → cosine matches BUT the recording shows no on-demand gesture → `❌ Challenge failed`. The CSPRNG randomization closes the predict-and-pre-record loophole.
5. **Sanity check — directional intent:** turn the wrong way for the prompted challenge (e.g. prompt says "RIGHT", turn LEFT) → `❌ Challenge failed` even though identity matches. Demonstrates that the system enforces direction, not just movement.
6. **Sync & Purge** (live from the bottom panel): tap **Sync queue** → mock POST payload prints in Metro (no raw images, just `id / personId / timestamp / matched / confidence / livenessPassed`). Tap **Purge all** → wipes the encrypted gallery + sync queue + transmit log in one call; subsequent verify returns no match.

**Visual:** rehearsed; ~90 seconds. Have ready: (a) a printed photo of yourself for Defeat #1, (b) a second phone with a 10-sec neutral video of yourself for Defeat #2.

**Notes:** "We've already iterated this loop dozens of times — the demo is what we've been running for two weeks."

---

## 12. What changed and what's next (defense + roadmap)

**Significant pivots we made, all logged in `DECISIONS.md`:**

| # | What we changed and why |
|---|---|
| D8 | Exported our own MIT MobileFaceNet because every clean small ArcFace ONNX traced to non-commercial weights (C6). |
| D9 | Skipped a custom Nitro plugin for v1 — Vision Camera 5 + fast-opencv + ORT-RN proved sufficient, retiring schedule risk *and* keeping Android free. |
| D10 | CSPRNG-based challenge selection (anti-replay prediction); native polyfill batched. |
| D11 | Measured the single MiniFASNet export on real iPhone selfies AND 2D photos — it saturates regardless of input, so it's not a discriminator on this device's camera distribution. Removed it as a binding gate; kept it in the pipeline as a transparency / extensibility hook exposed via `VerifyResult.passiveScore` for production to drop in a stronger fused passive model without touching the FaceAuth contract. |
| D12 | Added blink as a NON-BINDING bonus challenge so all three brief examples (blink/smile/turn) are visible, without risking a false-reject on stage from a noisy single-shot proxy that YuNet's 5 landmarks can't really support. |

**Roadmap (production):**

- ~~Encrypted MMKV-backed gallery + haptics + CSPRNG polyfill~~ — **shipped** in build `931044c`.
- ~~int8 quantization locked + bundled (1.36 MB recognition; 3.33 MB total)~~ — **shipped** 2026-05-28 (D4 lock).
- **Android rubric validation** on a real ~3 GB device + EP swap (NNAPI / XNNPACK).
- **Pose-robust recognition** (e.g., a swap to a larger MobileFaceNet variant) → expand the active-challenge set back to all three with confidence.
- **Two-model passive fusion** per Silent-Face's original design to make passive a true binding signal.

**Notes:** "We didn't follow the brief — we engaged with it. The decisions we adapted on are documented, measured, and defensible."

---

## 13. Thank you · Q&A

**Team — Ahmad Faraz** · Datalake FaceAuth · Hackathon 7.0

**Repo:** [github / your-url-here]  (full source · DECISIONS.md · LICENSES.md · integration guide · benchmarks)

**Headline once more:** three models · 3.33 MB · ~130 ms on iPhone · one TypeScript contract · open-source license-clean · offline-first by design.

**Visual:** clean closing slide; QR or short URL to the repo.

---

## Speaker timing target (~8 minutes)

| Slides | Time | Beat |
|---|---|---|
| 1–2 | 0:00–1:00 | Open + problem |
| 3 | 1:00–1:45 | Headline numbers — set expectations |
| 4 | 1:45–2:30 | Architecture |
| 5–6 | 2:30–4:00 | **Innovation** (compression + liveness) — heaviest beat |
| 7 | 4:00–4:30 | Latency story (honest) |
| 8–9 | 4:30–5:30 | **Feasibility + Scalability** (FaceAuth API, sync/purge) |
| 10 | 5:30–5:45 | Robustness |
| 11 | 5:45–7:15 | **Live demo** — sell here |
| 12–13 | 7:15–8:00 | Defense / roadmap / close |

Q&A: 2–3 minutes after.

## Suggested visuals to capture before submission

1. App screenshot of the Liquid Glass home screen with the camera preview (already captured).
2. App screenshot of an active challenge prompt mid-flow ("Turn slightly LEFT").
3. App screenshot of `✅ verified` result.
4. App screenshot of `🛑 Spoof blocked` / `❌ Challenge failed` (defeat shot).
5. (Optional) A short 10-second screen recording of the full register→verify loop, looped in Slide 11.
6. The headline-numbers table (3.33 MB · ~130 ms · 0.95) as a hero card on Slide 3.
