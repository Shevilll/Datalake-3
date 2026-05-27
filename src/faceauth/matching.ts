/**
 * Matching (§4.4): cosine similarity on L2-normalized embeddings; a person matches by the
 * MAX similarity across their multi-shot enrollments (§7). Threshold τ_match tuned on gallery.
 */

import { MATCHING, RECOGNITION } from './recipes';
import type { Embedding, EnrolledPerson } from './types';

/** L2-normalize in place-safe fashion; returns a new Float32Array (§4.3). */
export function l2normalize(v: Embedding): Embedding {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) sumSq += v[i]! * v[i]!;
  const inv = 1 / (Math.sqrt(sumSq) + 1e-10);
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i]! * inv;
  return out;
}

/** Cosine similarity. For L2-normalized inputs this is the dot product. */
export function cosine(a: Embedding, b: Embedding): number {
  if (a.length !== b.length) throw new Error(`cosine: dim mismatch ${a.length} vs ${b.length}`);
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot;
}

export interface MatchResult {
  readonly matched: boolean;
  readonly personId: string | null;
  readonly confidence: number;
}

/**
 * Match a probe embedding against the gallery. Returns the best person by max cosine over
 * their enrollment embeddings, and whether it clears τ_match.
 */
export function matchAgainstGallery(
  probe: Embedding,
  gallery: readonly EnrolledPerson[],
  tauMatch: number = MATCHING.tauMatch,
): MatchResult {
  if (probe.length !== RECOGNITION.embeddingDim) {
    throw new Error(`matchAgainstGallery: probe dim ${probe.length} != ${RECOGNITION.embeddingDim}`);
  }
  let bestId: string | null = null;
  let bestSim = -Infinity;
  for (const person of gallery) {
    for (const emb of person.embeddings) {
      const sim = cosine(probe, emb);
      if (sim > bestSim) {
        bestSim = sim;
        bestId = person.personId;
      }
    }
  }
  const confidence = bestSim === -Infinity ? 0 : bestSim;
  return { matched: bestId !== null && confidence >= tauMatch, personId: bestId, confidence };
}
