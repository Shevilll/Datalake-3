# Accuracy gallery — capture protocol & computation

> The Slice 5 evidence for **C5: recognition accuracy > 95% across diverse Indian demographics and outdoor lighting**. This doc tells you exactly what to capture, how to record the outcomes (using the app's already-shipped sync queue — no extra tooling), and how to compute the TAR / FAR / FRR table that goes onto Slide 10.

## 0. What "good" looks like

You're trying to fill out this table in [`benchmarks.md`](benchmarks.md) §4:

| Subject | Condition | Genuine attempts | True accepts | False rejects | Cos (median) |
|---|---|---|---|---|---|
| S1 | indoor neutral | … | … | … | … |
| S1 | harsh sun | … | … | … | … |
| … | … | … | … | … | … |

…plus a **single headline** that combines them: `overall accuracy = (TA + TR) / total = X.XX > 0.95`.

## 1. Recruit subjects (minimum 4–5, more = better evidence)

Aim for diversity across:

- **Skin tones** — at least 3 different points across the spectrum.
- **Gender presentation** — at least one of each, since YuNet / MobileFaceNet were trained on mixed datasets but we want to show robustness.
- **Glasses** — at least one subject with prescription glasses.
- **Age range** — at least one subject outside 20–30 if you can swing it.

The brief specifies *Indian demographics* — try to reflect that in subject selection if possible (family, friends, fellow students). 4–5 subjects is sufficient evidence; 8–10 is excellent.

## 2. Capture conditions (4 conditions × all subjects)

Hit at least these four lighting / environment buckets per subject:

| ID | Condition | Where / when |
|---|---|---|
| C1 | **Indoor neutral** | Indoors, even artificial light. Baseline. |
| C2 | **Harsh sun** | Outdoors mid-day, direct sun on face (no shade). |
| C3 | **Shadow / backlit** | Outdoors with the sun behind the subject, or under a tree. |
| C4 | **Low light** | Indoors near a window at dusk, or in a dim room. |

Optional bonus (raises the C5 evidence quality):

| ID | Condition |
|---|---|
| C5 | with-glasses (if subject normally wears them, take BOTH a with-glasses and without-glasses pass) |
| C6 | with-mask (for an interesting failure-mode disclosure) |

## 3. Per-subject procedure (≈4 minutes per subject per condition)

For each subject **S** in each condition **C**:

1. **Enroll once.** In the app, type the name `S` (e.g. `S1_alice`) → tap **Register** 3–5 times with slight pose variation: frontal, slight left, slight right, smile. (Multi-shot enrollment is load-bearing — see D11. Skipping this will tank your numbers.)
2. **Note in a notebook (or this template — copy it into a file as you go):**
   ```
   subject: S1_alice
   condition: C1_indoor
   enrolled_samples: 5
   ```
3. **Run 5 genuine verify attempts.** Subject `S` stays in front of the camera. Tap **Verify** → perform the gesture → **Capture**. Record each outcome:
   ```
   genuine_attempts:
     - 1: matched=true   cos=0.81  challenge=smile      verdict=✅
     - 2: matched=true   cos=0.76  challenge=headLeft   verdict=✅
     - 3: matched=false  cos=0.41  challenge=headRight  verdict=❌ (FRR)
     - 4: matched=true   cos=0.79  challenge=headLeft   verdict=✅
     - 5: matched=true   cos=0.83  challenge=smile      verdict=✅
   ```
4. **Run 5 impostor attempts.** Bring a **different** subject in front of the camera (the gallery still has S enrolled). Tap **Verify** → perform the gesture → **Capture**. Each should `matched=false`:
   ```
   impostor_attempts:
     - 1: matched=false  cos=0.12  challenge=smile      verdict=✅ (true reject)
     - 2: matched=false  cos=0.18  challenge=headLeft   verdict=✅
     - …
     - 4: matched=true   cos=0.52  challenge=smile      verdict=❌ (FAR)
     - 5: matched=false  cos=-0.03 challenge=headRight  verdict=✅
   ```
5. **Purge.** Tap **Purge all** between subjects so each subject is tested against a clean gallery. (Multi-subject enrollment is realistic but introduces gallery-cross-contamination noise we don't want for a clean evidence table.)

Per subject per condition you'll have 10 outcomes (5 genuine + 5 impostor). With 4 subjects × 4 conditions × 10 = **160 attempts** — that's the body of evidence.

## 4. Don't re-type the cosines — use the sync queue

The app already records every verify outcome in the local queue with full payload (id, personId, timestamp, matched, confidence, livenessPassed). You don't need to copy each cosine by hand:

1. Run all the verifies for one condition in a session.
2. At the end of the session tap **Sync queue** in the bottom panel.
3. The mock cloud upload **logs the exact JSON payload to Metro** (your terminal running `npx expo start`). Copy that block into your notebook.
4. Tap **Purge all** before starting the next subject.

The Metro output looks like:
```
[FaceAuth] mock sync POST: {"id":"evt-1716889423110","personId":"S1_alice","timestamp":...,"matched":true,"confidence":0.81,"livenessPassed":true}
```
That's already CSV-shaped — paste into a spreadsheet, split by `,`, and you have your raw data.

(Note: the `personId` field is `null` on a `matched=false` outcome, so for impostor attempts you'll cross-reference your notebook by `timestamp`.)

## 5. Compute the headline numbers

Aggregate across all subjects & conditions:

```
Total genuine attempts     G  = subjects × conditions × 5
Total impostor attempts    I  = subjects × conditions × 5
True accepts               TA = genuine attempts where matched=true
False rejects              FR = genuine attempts where matched=false  → FRR = FR / G
False accepts              FA = impostor attempts where matched=true  → FAR = FA / I
True rejects               TR = impostor attempts where matched=false

Overall accuracy = (TA + TR) / (G + I)
```

**The brief's bar is `accuracy > 0.95`.** Realistic expectations on the shipped int8 MobileFaceNet at τ_match=0.4–0.5 with multi-shot enrollment:

- TAR (genuine accept rate) **0.92–0.98** depending on lighting harshness.
- FAR (false accept rate) **0.00–0.02** at τ_match=0.5; **0.01–0.05** at τ_match=0.4.
- FRR (false reject rate) **0.02–0.08**, mostly under harsh sun or low light.

If overall accuracy lands under 0.95, the levers (in order of cost):

1. **Raise τ_match** (from 0.4 → 0.5). Cuts FAR more than it hurts TAR.
2. **Add more enrollment shots** for the failing subjects.
3. **Swap recognition.onnx for `models/recognition.fp16.onnx`** (one-file replace — bit-identical to fp32). int8's 6% margin drop becomes the suspect when accuracy is borderline.

## 6. What to put in `benchmarks.md`

Replace the `_TBD_` rows in §4 with the measured numbers:

```markdown
| Threshold | Value | TAR | FAR | FRR | Accuracy |
|---|---|---|---|---|---|
| τ_match (cosine) | 0.45 | 0.96 | 0.01 | 0.04 | 0.97 |
| τ_live (passive) | n/a — active-binding (D11) | — | — | — | — |
```

And add a per-condition breakdown table so the reader can see lighting wasn't cherry-picked. Then update Slide 10 of the deck to cite the headline number ("`accuracy 0.97 across N=160 attempts, 4 subjects, 4 lighting conditions`").

## 7. Time estimate

- Recruiting + scheduling: 1–2 days of background calls.
- Captures: ~20 minutes per (subject × condition) cell. 16 cells × 20 min ≈ 5–6 hours total over 1–2 sessions.
- Tabulation + computation: ~1 hour.

**Plan for ~1 active day of capture + analysis.**
