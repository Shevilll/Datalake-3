/**
 * Single source of truth for the FaceAuth domain types.
 * Shared by the native pipeline bridge, the JS pipeline, and UI consumers (§3b, §8).
 *
 * NOTE on the active-challenge set: per DECISIONS.md D3 / D11 the binding active
 * gestures are head-turn (left/right) and smile — both computable from YuNet's
 * 5 landmarks. Blink is shipped as a NON-BINDING bonus challenge (D12): the prompt
 * is presented + a noisy single-shot proxy is reported, but the fusion verdict
 * does not depend on it (a false-reject on stage is worse than not having blink).
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface FaceBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** YuNet's 5 landmarks, in this exact order (ArcFace alignment depends on it). */
export interface Landmarks5 {
  readonly rightEye: Point;
  readonly leftEye: Point;
  readonly nose: Point;
  readonly rightMouth: Point;
  readonly leftMouth: Point;
}

export interface Detection {
  readonly box: FaceBox;
  readonly landmarks: Landmarks5;
  readonly score: number;
}

/** A 512-d face embedding. Always L2-normalized before storage/comparison (§4.3/§4.4). */
export type Embedding = Float32Array;

export interface LivenessResult {
  /** livenessScore = 1 - (p_print + p_replay) == p_real (§4.2). */
  readonly score: number;
  readonly probs: readonly [real: number, print: number, replay: number];
}

export type ActiveChallenge = 'headLeft' | 'headRight' | 'smile' | 'blink';

/** The result of a full verify pass — the headline object the demo + Datalake read (§8). */
export interface VerifyResult {
  readonly matched: boolean;
  readonly personId: string | null;
  /** cosine similarity of the best match. */
  readonly confidence: number;
  readonly livenessPassed: boolean;
  readonly passiveScore: number;
  readonly activeChallenge: ActiveChallenge;
  /** end-to-end latency for the <1 s claim (C3). */
  readonly latencyMs: number;
}

/** One enrolled identity with N multi-shot embeddings (§7). Never stores raw images. */
export interface EnrolledPerson {
  readonly personId: string;
  readonly embeddings: readonly Embedding[];
  readonly enrolledAt: number;
}

/** Audit record queued for sync (§10). Never contains raw images — embeddings stay local. */
export interface VerificationRecord {
  readonly id: string;
  readonly personId: string | null;
  readonly timestamp: number;
  readonly matched: boolean;
  readonly confidence: number;
  readonly livenessPassed: boolean;
}

/** The public FaceAuth contract Datalake 3.0 integrates against (§8). */
export interface FaceAuthApi {
  register(personId: string): Promise<{ ok: boolean; samples: number }>;
  verify(): Promise<VerifyResult>;
  listEnrolled(): Promise<string[]>;
  deletePerson(personId: string): Promise<boolean>;
  queueForSync(record: VerificationRecord): Promise<void>;
  syncNow(): Promise<{ synced: number }>;
  purgeLocal(): Promise<{ purged: number }>;
}
