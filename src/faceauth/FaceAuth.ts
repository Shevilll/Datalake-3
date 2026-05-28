/**
 * FaceAuth — the public integration contract (CLAUDE.md §8).
 *
 * This is what Datalake 3.0 calls. It composes:
 *   - the inference pipeline (detect / align / embed / passive liveness)
 *   - the local gallery (multi-shot enrollment, cosine matching)
 *   - the active liveness challenge (binding per D11)
 *   - the sync queue + mock cloud + purge (§10 / C8)
 *
 * UI is decoupled via a CaptureProvider: the host (typically a camera screen) registers
 * one function that obtains a captured face. The facade then orchestrates everything.
 * This is the dependency injection that lets the same FaceAuth API ship in any UI shell.
 */

import type { Mat } from 'react-native-fast-opencv';

import {
  type ActiveChallenge,
  computeGeometry,
  randomChallenge,
  satisfiesChallenge,
} from './activeLiveness';
import { addEnrollment, deletePerson as galleryDelete, listEnrolled as galleryList } from './gallery';
import { type Sessions, loadSessions } from './ort';
import { enrollFromMat, verifyFromMat } from './pipeline';
import type { FaceAuthApi, VerificationRecord, VerifyResult } from './types';
import { purgeLocal as syncPurge, queueForSync as syncQueueForSync, syncNow as syncDrain } from '../sync/syncQueue';

/** What the host returns from a capture: an OpenCV Mat (BGR) plus its dimensions. */
export interface CapturedFace {
  readonly mat: Mat;
  readonly width: number;
  readonly height: number;
}

/**
 * Obtain a captured face. If `challenge` is supplied (verify path), the host should display
 * the prompt to the user, wait for them to perform the gesture, and only then capture.
 */
export type CaptureProvider = (challenge?: ActiveChallenge) => Promise<CapturedFace>;

/** Front-camera yaw sign calibration (D11). Override via FaceAuth.configure if needed per device. */
let yawSign: 1 | -1 = -1;

let captureProvider: CaptureProvider | null = null;
let sessionsPromise: Promise<Sessions> | null = null;

function requireCapture(): CaptureProvider {
  if (!captureProvider) {
    throw new Error(
      'FaceAuth: install a CaptureProvider first via FaceAuth.setCaptureProvider(...). The provider obtains a captured face — typically wrapping your camera screen.',
    );
  }
  return captureProvider;
}

function ensureSessions(): Promise<Sessions> {
  if (!sessionsPromise) sessionsPromise = loadSessions();
  return sessionsPromise;
}

/**
 * The FaceAuth integration contract (§8). Stable, typed API that consumers (Datalake 3.0) call.
 * Implementation details (model paths, recipes, thresholds) are not exposed.
 */
export const FaceAuth: FaceAuthApi & {
  setCaptureProvider(fn: CaptureProvider | null): void;
  configure(opts: { yawSign?: 1 | -1 }): void;
  preload(): Promise<void>;
} = {
  setCaptureProvider(fn) {
    captureProvider = fn;
  },

  configure(opts) {
    if (opts.yawSign !== undefined) yawSign = opts.yawSign;
  },

  /** Eagerly load the ORT sessions so the first call isn't penalized. */
  async preload() {
    await ensureSessions();
  },

  async register(personId) {
    const sessions = await ensureSessions();
    const { mat, width, height } = await requireCapture()();
    const out = await enrollFromMat(sessions, mat, width, height);
    if (!out.ok || !out.embedding) return { ok: false, samples: 0 };
    const samples = addEnrollment(personId, out.embedding);
    return { ok: true, samples };
  },

  async verify(): Promise<VerifyResult> {
    const sessions = await ensureSessions();
    const challenge = randomChallenge();
    const { mat, width, height } = await requireCapture()(challenge);
    const out = await verifyFromMat(sessions, mat, width, height);
    let livenessPassed = false;
    if (out.detection) {
      livenessPassed = satisfiesChallenge(challenge, computeGeometry(out.detection.landmarks), yawSign);
    }
    return {
      matched: out.matched,
      personId: out.matched ? out.personId : null,
      confidence: out.confidence,
      livenessPassed,
      passiveScore: out.passiveScore,
      activeChallenge: challenge,
      latencyMs: out.latencyMs,
    };
  },

  async listEnrolled() {
    return galleryList();
  },

  async deletePerson(personId) {
    return galleryDelete(personId);
  },

  async queueForSync(record: VerificationRecord) {
    syncQueueForSync(record);
  },

  async syncNow() {
    return syncDrain();
  },

  async purgeLocal() {
    return syncPurge();
  },
};
