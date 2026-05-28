/**
 * Local enrollment gallery. Slice 1: in-memory (proves the loop). Slice 3 swaps the backing
 * store for encrypted MMKV (embeddings-at-rest, §10) behind this same API — never raw images.
 */

import type { Embedding, EnrolledPerson } from './types';

const store = new Map<string, { embeddings: Embedding[]; enrolledAt: number }>();

export function addEnrollment(personId: string, embedding: Embedding): number {
  const existing = store.get(personId);
  if (existing) {
    existing.embeddings.push(embedding);
    return existing.embeddings.length;
  }
  store.set(personId, { embeddings: [embedding], enrolledAt: Date.now() });
  return 1;
}

export function getGallery(): EnrolledPerson[] {
  return [...store.entries()].map(([personId, v]) => ({
    personId,
    embeddings: v.embeddings,
    enrolledAt: v.enrolledAt,
  }));
}

export function listEnrolled(): string[] {
  return [...store.keys()];
}

export function deletePerson(personId: string): boolean {
  return store.delete(personId);
}

/** Wipe everything (the purgeLocal() primitive, §10). Returns count removed. */
export function purgeAll(): number {
  const n = store.size;
  store.clear();
  return n;
}
