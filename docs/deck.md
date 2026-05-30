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

**Visual:** the iOS 26 Liquid Glass home screen over live camera (`iosDemo/IMG_5666`) beside the Android verified result (`androidDemo/IMG_5719`) — same one app, both platforms, captured on real devices. Plus a tiny logo or wordmark.

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
| Verify pipeline latency (iPhone 17 Pro Max, functional) | — | **~130 ms** |
| Verify pipeline latency (**Redmi 9 Power**, rubric-class Android) | < 1 s | **~620 ms median** (582–931 ms) — **C3 met ✓** |
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

**Cross-platform claim, made concrete — now proven on real Android hardware.** The entire recognition pipeline under `src/faceauth/` (detection, alignment, embedding, matching, active liveness, gallery, sync) is **platform-agnostic TypeScript** with zero `Platform.OS` branches and no native imports — it ran unchanged on Android. Bringing up the real device surfaced a handful of small, documented adaptations confined to the **screen/capture layer** (never the pipeline):

- **ORT autolinking (D13):** a stale `unimodule.json` in `onnxruntime-react-native` made Expo's autolinker skip its Android package → fixed with a one-file `react-native.config.js`.
- **Capture path (D14):** this budget Qualcomm HAL rejects CameraX's preview+photo stream combination, so Android captures via a preview **snapshot** (single stream); iOS keeps the photo output.
- **UI fallback + mirror (D14):** Liquid Glass degrades to solid light cards off iOS 26, and the front-camera mirror flips the head-turn yaw sign — both handled with small `Platform.OS` branches in the screen.

The execution-provider knob (CPU EP today; CoreML / NNAPI / XNNPACK swappable per platform) stays a config line.

**Notes:** "We didn't get Android 'for free' and won't claim we did — the pipeline ported unchanged, but a real budget device needed a few days of honest debugging at the screen layer (autolinking, a camera stream-combo limit, the glass fallback, a mirror flip). All documented in DECISIONS. The payoff: it runs end-to-end on a Redmi 9 Power, the rubric's hardware class — not a slideware claim."

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
| **Neutral / autonomously-playing replay** of the subject sitting still | the recording shows no gesture; an autonomously-looping clip can't respond to the per-verify prompt, so the prompted gesture never appears | play a still-frame / neutral video on a second phone → `Verify` → `❌ Challenge failed` |

**Passive MiniFASNet — exposed as a transparency / extensibility hook, NOT a binding gate.** We measured the single MiniFASNet-V2 export on real iPhone-front-camera selfies and a 2D press photo from the same pipeline: it saturates to the same score on both — it doesn't discriminate on this device's camera distribution (D11, `docs/benchmarks.md` §4). We surface the score in `VerifyResult.passiveScore` for honesty and so a production deployment can drop in a stronger model (Silent-Face's two-model fused design, or a newer export) **without changing the FaceAuth contract or any other code**. Hard-gating on this single export would lock real users out — that's not a trade we'll defend.

**Honest scope of the active-only signal — and the mitigation already in the API.** Single-challenge (`n=1`) active liveness defeats a printed photo and any autonomously-playing replay. It does **not**, on its own, defeat a *human-operated* video that scrubs to the prompted gesture on cue (a recording of the subject turning + smiling, played back responsively). Our answer is `randomChallengeSequence(n)`, which raises per-attempt entropy to `n × log₂(3) ≈ 1.58n` bits and forces a *sequence* the operator can't pre-stage — at `n=2`, blind success drops to **(1/3)² ≈ 11%**. It's in the API today (wire per deployment), and the production roadmap adds two-model passive fusion (D11) as the texture-based backstop.

**Notes:** "Most teams will ship active-only and not say so, OR hard-gate on passive without ever testing whether it discriminates. We did the test, kept passive in the pipeline as a transparency hook, and made active the binding signal that actually works. We demo printed-photo defeat and neutral-replay defeat — both fail on the gesture. If a judge asks 'what about a video of me turning my head, played on cue?' — own it: that beats single-challenge active liveness, which is *exactly* why we built `randomChallengeSequence(n)` (n=2 → ~11% blind success) and why the roadmap adds two-model passive fusion. We don't pretend n=1 active is unbreakable; we show we engineered the next layer for it."

---

## 7. Feasibility: ~130 ms on iPhone (functional) · ~620 ms on rubric-class Android (C3 met)

| Phase | Time |
|---|---|
| Photo decode (JPEG → BGR Mat) | included |
| Orientation auto-correct (try +0°, ±90°, 180°) | first hit; cached on demo |
| YuNet detect (decoded in TS) | **13 ms** |
| ArcFace-aligned MobileFaceNet embed | **3 ms** |
| MiniFASNet passive | **2 ms** |
| Cosine match against multi-shot gallery | ~0 |
| **End-to-end verify (iPhone, CPU EP)** | **~130 ms** |

**The rubric Android number — measured, not pending.** Per `CLAUDE.md` §0a, the iPhone is a *functional* check only; the C3 number must come from real mid-range Android hardware. We ran the full pipeline on a **Redmi 9 Power (M2010J19SI, Snapdragon 662)** — a budget Qualcomm device in the C4 class:

| Device | Verify pipeline (`latencyMs`) |
|---|---|
| iPhone 17 Pro Max (functional only) | ~130 ms |
| **Redmi 9 Power** (rubric-class) | **median ~620 ms · range 582–931 ms** |

40 live verifies, on-device, CPU EP. The on-screen latency in the demo (e.g. `590 ms` on the verified result, `androidDemo/`) is this exact metric. **Max observed 931 ms < the 1 s budget — C3 is met on the real target, not the flagship.**

> Scope: detect → liveness → embed → match (the value the app surfaces as `latencyMs`). Camera capture + JPEG decode are additional, and the user-paced active gesture isn't counted — the **same scope** as the iPhone figure, so the two are directly comparable.

**Notes:** "We said we wouldn't quote the flagship as the rubric number — so we didn't. We put the pipeline on a real budget Qualcomm phone and measured 40 verifies: 620 ms median, 931 ms worst case, under the second. The number on the slide is the number on the screen in the demo photos."

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

**Runs on both platforms** — iPhone 17 Pro Max for the polished iOS 26 Liquid Glass demo, **Redmi 9 Power** for the rubric-class proof. Both are airplane-mode capable and both are captured end-to-end in `iosDemo/` and `androidDemo/` (register → all three challenges → ✅ verified → ❌ challenge-failed). The flow below is identical on each:

1. **Register Ahmad** — capture 4–5 shots with slight pose variation (frontal, slight left, slight right, smile). Top pill shows "1 enrolled".
2. **Verify** — tap → randomized challenge prompt appears in the Liquid Glass banner ("Turn slightly LEFT", "Smile", or occasionally the bonus "Blink twice"). Perform → Capture → result panel: `✅ Ahmad — verified (cos 0.8x, ~130 ms)` + a **Success** haptic. The bonus blink prompt makes the brief's full example list — blink/smile/turn — visibly covered (D12).
3. **Defeat #1 — printed photo:** hold a printed photo of Ahmad to the camera → cosine matches the enrolled face BUT the flat photo can't perform the prompted gesture → `❌ Challenge failed`. Runs cleanly on every attempt regardless of which gesture the CSPRNG picks.
4. **Defeat #2 — replayed neutral video:** play a still-frame / neutral-sitting video of Ahmad on a second phone → cosine matches BUT the recording shows no on-demand gesture → `❌ Challenge failed`. Scope this honestly: this defeats an autonomously-playing replay. A *human-operated* video scrubbed to the prompted gesture can beat single-challenge active liveness — own it and point to `randomChallengeSequence(n)` (n=2 → ~11% blind success) + the two-model passive-fusion roadmap (D11) as the layered answer. Don't claim n=1 active is unbreakable.
5. **Sanity check — directional intent:** turn the wrong way for the prompted challenge (e.g. prompt says "RIGHT", turn LEFT) → `❌ Challenge failed` even though identity matches. Demonstrates that the system enforces direction, not just movement.
6. **Sync & Purge** (live from the bottom panel): tap **Sync queue** → mock POST payload prints in Metro (no raw images, just `id / personId / timestamp / matched / confidence / livenessPassed`). Tap **Purge all** → wipes the encrypted gallery + sync queue + transmit log in one call; subsequent verify returns no match.

**Visual:** rehearsed; ~90 seconds. Have ready: (a) a printed photo of yourself for Defeat #1, (b) a second phone with a 10-sec neutral video of yourself for Defeat #2.

**Notes:** "We've already iterated this loop dozens of times — the demo is what we've been running for two weeks." **If asked 'could a video of you turning your head beat this?'** — answer directly: "Yes, a human-operated video scrubbed to the prompted gesture beats single-challenge active liveness — that's a known limit of active-only, and we don't hide it. We built `randomChallengeSequence(n)` for exactly that (n=2 → ~11% blind success), and the production roadmap adds two-model passive fusion as the texture backstop. We chose to ship the honest, working binding signal rather than hard-gate on a passive export we measured as non-discriminating (D11)."

---

## 12. What changed and what's next (defense + roadmap)

**Significant pivots we made, all logged in `DECISIONS.md`:**

| # | What we changed and why |
|---|---|
| D8 | Exported our own MIT MobileFaceNet because every clean small ArcFace ONNX traced to non-commercial weights (C6). |
| D9 | Skipped a custom Nitro plugin for v1 — Vision Camera 5 + fast-opencv + ORT-RN proved sufficient, retiring schedule risk and keeping the Android port a build + real-device bring-up (D13/D14), not a rewrite. |
| D10 | CSPRNG-based challenge selection (anti-replay prediction); native polyfill batched. |
| D11 | Measured the single MiniFASNet export on real iPhone selfies AND 2D photos — it saturates regardless of input, so it's not a discriminator on this device's camera distribution. Removed it as a binding gate; kept it in the pipeline as a transparency / extensibility hook exposed via `VerifyResult.passiveScore` for production to drop in a stronger fused passive model without touching the FaceAuth contract. |
| D12 | Added blink as a NON-BINDING bonus challenge so all three brief examples (blink/smile/turn) are visible, without risking a false-reject on stage from a noisy single-shot proxy that YuNet's 5 landmarks can't really support. |
| D13 | First-ever Android build crashed at launch: `onnxruntime-react-native`'s stale `unimodule.json` made Expo's autolinker skip its native package (module absent under bridgeless New Arch). Fixed with a one-file `react-native.config.js` + a `TurboModuleRegistry`-based ORT binding patch. Diagnosed from on-device logcat, not guesswork. |
| D14 | Android runtime bring-up on a real Redmi 9 Power: snapshot-based capture (the budget Qualcomm HAL can't configure CameraX's preview+photo stream combo), Liquid-Glass→solid-light-card fallback off iOS 26, and a platform-specific yaw-sign flip for the mirrored front-camera preview. |

**Roadmap (production):**

- ~~Encrypted MMKV-backed gallery + haptics + CSPRNG polyfill~~ — **shipped** in build `931044c`.
- ~~int8 quantization locked + bundled (1.36 MB recognition; 3.33 MB total)~~ — **shipped** 2026-05-28 (D4 lock).
- ~~Android rubric validation on real hardware~~ — **shipped** 2026-05-30: full pipeline runs end-to-end on a Redmi 9 Power, ~620 ms median verify (D13/D14). Next: EP swap (NNAPI / XNNPACK) to push the budget-device latency down further.
- **Pose-robust recognition** (e.g., a swap to a larger MobileFaceNet variant) → expand the active-challenge set back to all three with confidence.
- **Two-model passive fusion** per Silent-Face's original design to make passive a true binding signal.

**Notes:** "We didn't follow the brief — we engaged with it. The decisions we adapted on are documented, measured, and defensible."

---

## 13. Thank you · Q&A

**Team — Ahmad Faraz** · Datalake FaceAuth · Hackathon 7.0

**Repo:** [github / your-url-here]  (full source · DECISIONS.md · LICENSES.md · integration guide · benchmarks)

**Headline once more:** three models · 3.33 MB · ~130 ms iPhone / **~620 ms on a rubric-class Redmi 9 Power** · one TypeScript contract · open-source license-clean · offline-first, proven on **both** platforms.

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

## Demo screenshots — captured on real devices (`iosDemo/` + `androidDemo/`)

The full register → challenge → verify → fail loop is captured on **both** platforms. Place an iOS + Android pair side-by-side per beat to make the cross-platform claim visual:

| Beat | iOS (Liquid Glass) | Android (light-card fallback) |
|---|---|---|
| Home / camera ready | `iosDemo/IMG_5666` | `androidDemo/IMG_5700` |
| Active challenge — Turn RIGHT | `iosDemo/IMG_5673` | `androidDemo/IMG_5703` / `IMG_5710` |
| Active challenge — Turn LEFT | `iosDemo/IMG_5694` | `androidDemo/IMG_5706` |
| Active challenge — Smile | — | `androidDemo/IMG_5717` |
| ✅ Verified (id + cos + ms) | `iosDemo/` (verified shot) | **`androidDemo/IMG_5719`** — `✅ Ahmad Faraz · cos 0.733 · 590 ms` |
| ❌ Challenge failed (defeat) | `iosDemo/` (defeat shot) | `androidDemo/IMG_5713` (590 ms) / `IMG_5715` (605 ms) |

Notes for the deck build:
- The **Android verified shot (`IMG_5719`)** is the single most valuable slide asset: it shows the rubric-class device, light theme, a real cosine, and the **590 ms** latency on-screen — evidence for C1/C3/C5 in one frame.
- iOS shots show real iOS 26 Liquid Glass **in airplane mode** (status bar) — offline proof.
- Android `screencap` renders the camera preview black, so the `androidDemo/` shots are phone-screen photos — that's expected and fine.
- Still want a hero card on Slide 3: the headline numbers (3.33 MB · ~620 ms Android · 0.95).
