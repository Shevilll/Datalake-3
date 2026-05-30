# Datalake FaceAuth — Install & Test Guide (Reviewers)

Offline facial recognition + liveness detection prototype, built in React Native (Expo)
for **Hackathon 7.0**. This guide is for **NHAI reviewers** to install and test the app
on a physical Android device with **no developer setup** — no Metro server, no accounts.

> The app is **fully offline**. Once installed, it runs end-to-end in **airplane mode**:
> nothing is sent to any server, and biometric data never leaves the device.

---

## 1. What you need

- A physical **Android phone**, **Android 8.0+**, **3 GB RAM or more** (the graded hardware floor).
- ~1 minute to install. No Google Play, no account, no cable.
- (No iOS install link is provided — Apple distribution requires TestFlight/UDID
  provisioning. iOS is shown in the live demo; the codebase is shared, so behaviour is
  identical across platforms.)

## 2. Install the APK

1. On the Android phone, open the **install link** provided in the submission
   (the EAS build page) and tap **Download**.
2. Open the downloaded `.apk`. Android will warn about installing from an unknown
   source — tap **Settings → Allow from this source**, then **Install**.
3. Open the app: **Datalake FaceAuth**.
4. Grant the **Camera** permission when prompted (used on-device only).

## 3. Test script (≈3 minutes)

> Turn on **Airplane mode** before step 1 to prove the whole flow is offline.

### A. Register a person
1. Open the **Register** screen.
2. Enter a person ID (e.g. `reviewer1`).
3. Capture the guided shots (look straight, slight angles). The app stores **encrypted
   face embeddings only — never images.**
4. Confirm it reports the number of samples saved.

### B. Verify (recognition + liveness)
1. Open the **Verify** screen.
2. The app runs: **face detection → passive liveness → a randomized active challenge
   → recognition → match.**
3. Perform the on-screen challenge (e.g. *turn head left*, *smile*) within the time window.
4. Expect: **matched = true**, the person ID, a confidence score, **liveness passed**,
   and the end-to-end **latency in ms**.

### C. Defeat a spoof (liveness proof)
- **Printed photo / photo on another phone:** hold a photo of the enrolled person to the
  camera. The face may *recognize*, but the randomized gesture **cannot be performed by a
  flat image** → result is **❌ Challenge failed → verified = false**.
- **Replayed video:** play a neutral recording of the person. The unpredictable, per-attempt
  gesture prompt won't match the recording → **❌ Challenge failed**.

### D. Sync & purge (data lifecycle)
1. Open the **Admin** screen.
2. **Queue for sync** a verification record, then **Sync now** — drains a local queue to a
   mock cloud and logs exactly what *would* be transmitted (no real network; records carry
   no raw images).
3. **Purge local** — wipes all embeddings, logs, and queued records. Confirm local data is gone.

## 4. What to look for (maps to the brief)

| Claim | How to confirm |
|---|---|
| **Fully offline** | Everything above works in airplane mode |
| **Liveness defeats photo + replay** | Section C — both fail the active challenge |
| **Recognition accuracy** | Section B matches the enrolled person, rejects others |
| **Latency < 1 s** | Latency shown on the Verify result (see `docs/benchmarks.md` for the measured target-device number) |
| **Model footprint** | 3.33 MB total of models bundled — see `docs/benchmarks.md` |
| **Privacy / purge** | Embeddings encrypted at rest; `Purge local` wipes them live |

## 5. Troubleshooting

- **"App not installed" / blocked:** enable *Install unknown apps* for your browser or
  Files app, then retry.
- **Camera is black:** ensure the Camera permission was granted (Android Settings → Apps →
  Datalake FaceAuth → Permissions).
- **Face not detected:** improve lighting and hold the phone at arm's length, face centered.

## 6. Source & documentation

- Full source is included per the open-source requirement (C6).
- `docs/architecture.md` — system design and data flow.
- `docs/benchmarks.md` — size / latency / accuracy tables.
- `docs/integration-guide.md` — how Datalake 3.0 wires in the `FaceAuth` module.
