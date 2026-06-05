# NHAI Face Auth — Offline Facial Recognition & Liveness (Expo / React Native)

A lightweight, **fully offline** facial recognition + liveness-detection prototype for
authenticating field personnel in zero-network zones, built for **NHAI Hackathon 7.0**.

Everything — face detection, liveness, recognition — runs **on-device** with bundled
models. No image or biometric data ever leaves the phone. Runs in **Expo Go** (no native
build required) on Android and iOS.

---

## How it maps to the problem statement

| Requirement | This prototype |
|---|---|
| React Native, Android + iOS | Expo (managed) — runs in Expo Go on both platforms |
| Offline, zero-network | All inference + storage on-device; no network calls for auth |
| Lightweight model (~20 MB target) | Bundled models total **7.1 MB** |
| Liveness / anti-spoofing | Challenge–response (blink / smile / open mouth / turn head) |
| Recognition | 128-d face descriptors, Euclidean match (face-api `FaceRecognitionNet`) |
| Sync & purge | Offline-first SQLite queue → upload to AWS → purge local copies |
| Open-source only | TensorFlow.js (Apache-2.0) + @vladmandic/face-api (MIT). No paid licences |

---

## Tech stack

- **Expo SDK 56** (React Native 0.85) — managed workflow, Expo Go compatible
- **expo-camera** — front-camera capture
- **@vladmandic/face-api** + bundled **TensorFlow.js** (CPU backend, pure JS) — detection,
  68 landmarks, expressions, 128-d recognition descriptors
- **jpeg-js** — decode camera frames to tensors on-device
- **expo-sqlite** — offline store for personnel, face templates and attendance
- **@react-navigation** — screen navigation

> Why the CPU backend? Expo Go cannot load custom native modules (no native TFLite / GPU
> delegate / `react-native-vision-camera`). The pure-JS TF.js CPU backend is the only path
> that runs real on-device ML *inside Expo Go*. See **Performance** for the trade-off and
> the drop-in upgrade path to sub-second inference.

---

## How it works (pipeline)

```
expo-camera (still)            jpeg-js                    face-api (TF.js, CPU)
   takePicture()  ──uri──▶  decode → RGB Tensor3D  ──▶  detect → landmarks → {expressions | descriptor}
                                                              │
                          ┌───────────────────────────────────┴───────────────┐
                          ▼                                                     ▼
                  Liveness (challenge–response)                        Recognition
            EAR (blink) · MAR (mouth) · happy (smile) ·         128-d descriptor → Euclidean
            yaw proxy (head turn); 2 random actions             match vs enrolled templates
                          │                                       (threshold ≈ 0.55)
                          └──────────────▶ pass ───────────────────────┘
                                                     │
                                          SQLite attendance log
                                                     │
                                   Sync (when online) → AWS → purge local
```

The liveness loop uses the **fast path** (detection + landmarks + expressions, no descriptor).
The heavy ResNet descriptor only runs for the final recognition step, keeping the loop responsive.

---

## Project structure

```
NHAIFaceAuth/
├── App.tsx                     # Navigation root + providers
├── app.json                    # Camera permissions, asset bundling, plugins
├── metro.config.js             # Bundle *.bin assets; force face-api browser build
├── assets/models/              # Bundled TF.js weights (7.1 MB, offline)
│   ├── tiny_face_detector/     #  detector            (193 KB)
│   ├── face_landmark_68/       #  68 landmarks         (357 KB)
│   ├── face_expression/        #  expressions (smile)  (329 KB)
│   └── face_recognition/       #  128-d descriptor     (6.4 MB)
└── src/
    ├── config.ts               # All tunable thresholds + sync endpoint
    ├── types.ts                # Shared domain types
    ├── theme.ts                # Design tokens
    ├── AppContext.tsx          # One-time engine + DB init, shared state
    ├── navigation.ts           # Route param types
    ├── ml/
    │   ├── modelAssets.ts      # static require() map of bundled weights
    │   ├── faceEngine.ts       # offline model loader + inference (the core)
    │   ├── image.ts            # JPEG uri → Tensor3D
    │   ├── liveness.ts         # metrics (EAR/MAR/yaw) + challenge evaluator
    │   └── recognition.ts      # Euclidean match + descriptor (de)serialise
    ├── db/database.ts          # expo-sqlite schema + CRUD
    ├── sync/syncService.ts     # offline→online sync & purge
    ├── components/             # FaceCamera (oval overlay), UI primitives
    └── screens/                # Home, Enroll, Verify, Records
```

---

## Running it

### A) Expo Go (fastest — for the demo)

```bash
cd NHAIFaceAuth
npm install
npx expo start
```

Scan the QR with the **Expo Go** app (Android/iOS). All face processing is on-device.

> In Expo Go *dev mode*, the JS bundle and model assets are still served by the Metro dev
> server over your LAN — so keep the phone on the same network for the initial load. **No
> internet is used for face detection/recognition.** For true airplane-mode operation, build
> a standalone app (below), which embeds everything locally.

### B) Standalone offline APK (true zero-network field use)

```bash
# Cloud build (no Android Studio needed):
npx eas build -p android --profile preview

# or local native build:
npx expo prebuild
npx expo run:android
```

The resulting app bundles the models and DB locally and runs with **no network at all**.

---

## Configuration

All thresholds live in [`src/config.ts`](src/config.ts):

- `recognitionThreshold` — Euclidean match cutoff (lower = stricter; face-api default ≈ 0.6)
- `enrollFrontYawMax` / `enrollTurnYawMin` — head-pose tolerances for the guided front/left/right capture
- `livenessChallengeCount` — actions required to prove liveness (default 2)
- `earClosed` / `marOpen` / `smileThreshold` / `yawTurnThreshold` — liveness sensitivity
- `inferenceMaxSize` / `detectorInputSize` — speed vs accuracy knobs
- `syncEndpoint` / `syncApiKey` — **set these to enable live AWS upload** (see Sync)

---

## Sync & purge

`src/sync/syncService.ts` implements offline-first sync:

1. Attendance is written locally (`synced = 0`).
2. When online, `syncNow()` POSTs all pending records to `CONFIG.syncEndpoint`
   (`Authorization: Bearer <syncApiKey>`), marks them synced, then **purges** the synced
   rows locally — satisfying the "local data to be purged" requirement.
3. With **no endpoint set**, it runs in **simulate mode**: the identical mark-synced + purge
   flow runs locally so the mechanism is fully demoable offline. The Records screen shows
   which mode is active.

Expected server payload:

```jsonc
POST {syncEndpoint}
{
  "source": "NHAIFaceAuth",
  "attendance": [
    { "clientId": 12, "personId": 3, "name": "...", "employeeId": "...",
      "timestamp": 1730000000000, "livenessPassed": true, "matchScore": 0.41 }
  ]
}
```

---

## Integrating into Datalake 3.0

The auth logic is decoupled from the UI, so it drops into an existing RN app:

1. Copy `src/ml/`, `src/db/`, `src/sync/` and `assets/models/`.
2. Merge `metro.config.js` (the two lines: add `bin` to `assetExts`; set
   `resolverMainFields` so `@vladmandic/face-api` uses its browser build).
3. Add deps: `@vladmandic/face-api`, `jpeg-js`, `expo-camera`, `expo-file-system`,
   `expo-asset`, `expo-sqlite`.
4. On app start: `await initDb(); await initFaceEngine();`
5. Use the primitives directly:
   ```ts
   const tensor = await uriToTensor(photoUri);
   const res = await analyzeForRecognition(tensor);     // {detection, landmarks, descriptor}
   const match = matchDescriptor(res.descriptor, await getAllTemplates());
   tensor.dispose();
   ```

See [`docs/TECHNICAL.md`](docs/TECHNICAL.md) for the deep-dive (architecture, model formats,
liveness math, threat model, benchmarks).

---

## Performance & accuracy (honest notes)

- **Footprint:** 7.1 MB of models; ~4.7 MB JS bundle. Well under the 20 MB target.
- **Speed:** On the pure-JS CPU backend a full recognition pass (detect + landmarks +
  ResNet descriptor) is typically **~1–3 s** on a mid-range phone; the liveness loop
  (no descriptor) is faster. To hit the **< 1 s** spec, swap the CPU backend for a native
  delegate in a **dev build** — e.g. `react-native-fast-tflite` (GPU/NNAPI) running a
  MobileFaceNet `.tflite`, behind the same `FaceEngine` interface. The app architecture and
  every other layer stay identical.
- **Accuracy:** face-api's `FaceRecognitionNet` reports ~99.38% on LFW. Real-world field
  accuracy depends on enrollment quality and lighting; capture multiple samples and tune
  `recognitionThreshold`. For best results in harsh Indian outdoor lighting, enroll in
  similar conditions.

## Privacy & security

- 100% on-device: no image, descriptor, or biometric is transmitted for authentication.
- Only a numeric 128-d descriptor (not the photo) is stored, in app-private SQLite.
- Liveness challenge–response defeats printed-photo and screen-replay spoofing.
- "Factory reset" purges all local personnel, templates and attendance.

## Licences

- TensorFlow.js — Apache-2.0
- @vladmandic/face-api and its model weights — MIT
- All other dependencies are open-source (MIT / Apache-2.0). No additional licences required.
