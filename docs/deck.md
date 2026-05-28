# Datalake FaceAuth — Hackathon 7.0 Deck

> Slide-by-slide content. Each `---` is a slide boundary. Drop into PowerPoint / Keynote / Google Slides; speaker notes are flagged with **Notes:** and visual cues with **Visual:**. ~12 slides, ~7–9 minute pitch.

---

## 1. Datalake FaceAuth

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
| Liveness defense | photo + replay | active randomized gesture (binding) + passive defense-in-depth |
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
- **No custom Swift/Kotlin** in v1 — Vision Camera 5 + fast-opencv + ORT Runtime handle everything. Cross-platform out of the box.
- **One TypeScript module** (`FaceAuth`) is the public surface. Internals can swap without breaking Datalake.

**Notes:** "By not writing a Nitro plugin ourselves, we kept the toolchain simple AND we get Android for free — same TS pipeline runs on both."

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

## 6. Innovation: dual liveness — active gesture (binding) + passive (defense-in-depth)

**Two layers, fused honestly:**

1. **Active randomized challenge** — `headLeft / headRight / smile`, **CSPRNG-picked** per verify, geometry-verified from YuNet's 5 landmarks (yaw proxy + mouth-corner spread).
2. **Passive MiniFASNet** — runs on every verify, reported in the result. *Informational only on this device class* (saturates on modern iPhone selfies — disclosed in DECISIONS.md D11).

**Fusion rule:** `verified = matched AND active-challenge-satisfied`.

**What this defeats:**
- **Printed / screen photo:** a flat photo can't smile or turn on command → active fails.
- **Replayed video:** the challenge is CSPRNG-randomized per verify → attacker can't pre-position the right pre-recorded gesture.

**Honest framing:** "We measured passive on real iPhone selfies; the single MiniFASNet export saturates regardless of input. We documented it transparently and made active the binding signal. Production would fuse two passive models per Silent-Face's design or swap a stronger passive model — the integration point is ready."

**Notes:** "Most teams will ship active-only OR will hard-gate on passive without measuring it. We measured, documented honestly, and chose the design that actually works."

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

**Demo live:** queue a record → `syncNow()` shows the exact payload that *would* be POSTed → `purgeLocal()` wipes the gallery; subsequent verifies return "no match" — proving local data is gone.

**Security story:**
- Biometric data **never leaves the device unencrypted**.
- **Encrypted-at-rest (MMKV, AES-128) — shipped.** Embeddings + queue persisted in an encrypted store; production would derive the key from iOS Keychain / Android Keystore (constant key in demo, noted in source).
- `purgeLocal()` is one method call away — auditable, demoable.

**Visual:** a sequence diagram or screenshot of the log box showing the mocked POST payload + the purge confirmation.

**Notes:** "Compliance asks the hard question: how do you wipe? Our answer is one function call away — and we demo it live."

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
2. **Verify** — tap → randomized challenge prompt appears in the Liquid Glass banner ("Turn slightly LEFT" or "Smile"). Perform → Capture → result panel: `✅ Ahmad — verified (cos 0.8x, ~130 ms)` + a **Success** haptic.
3. **Defeat #1 — printed/screen photo:** point camera at a phone showing Ahmad's photo → cosine matches BUT no commanded gesture → `❌ Challenge failed`.
4. **Defeat #2 — wrong direction:** turn the wrong way for the prompted challenge → `❌ Challenge failed` even though face matches. Randomization defeats pre-recorded replays.
5. **Sync & Purge** (live from the bottom panel): tap **Sync queue** → mock POST payload prints in Metro (no raw images, just `id / personId / timestamp / matched / confidence / livenessPassed`). Tap **Purge all** → wipes the encrypted gallery + sync queue + transmit log in one call; subsequent verify returns no match.

**Visual:** rehearsed; ~90 seconds. Have a printed photo of yourself or a second phone ready for defeat #1.

**Notes:** "We've already iterated this loop dozens of times — the demo is what we've been running for two weeks."

---

## 12. What changed and what's next (defense + roadmap)

**Significant pivots we made, all logged in `DECISIONS.md`:**

| # | What we changed and why |
|---|---|
| D8 | Exported our own MIT MobileFaceNet because every clean small ArcFace ONNX traced to non-commercial weights (C6). |
| D9 | Skipped a custom Nitro plugin for v1 — Vision Camera 5 + fast-opencv + ORT-RN proved sufficient, retiring schedule risk *and* keeping Android free. |
| D10 | CSPRNG-based challenge selection (anti-replay prediction); native polyfill batched. |
| D11 | Discovered the single MiniFASNet export saturates on modern iPhone selfies. Pivoted to active-primary fusion, kept passive informational — disclosed honestly. |

**Roadmap (production):**

- ~~Encrypted MMKV-backed gallery + haptics + CSPRNG polyfill~~ — **shipped** in build `931044c`.
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
