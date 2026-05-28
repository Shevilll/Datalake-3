/**
 * Local enrollment gallery — encrypted, MMKV-backed (§10 / C8 "embeddings encrypted at rest").
 *
 * Storage layout (per person):
 *   key `person:<personId>:embs`        ArrayBuffer of concatenated Float32 embeddings (N * 512 * 4 bytes)
 *   key `person:<personId>:enrolledAt`  number (ms)
 *
 * The MMKV instance is encrypted with AES (default AES-128). For a production deployment the
 * `encryptionKey` should be derived from a device-bound secret (iOS Keychain / Android Keystore).
 * For the hackathon demo we use a constant; the architecture cleanly supports any keying strategy.
 *
 * Implementation note: the surface is intentionally identical to the previous in-memory version,
 * so callers (pipeline, FaceAuth facade, sync queue) didn't have to change.
 */

import { createMMKV, type MMKV } from 'react-native-mmkv';

import { RECOGNITION } from './recipes';
import type { Embedding, EnrolledPerson } from './types';

const ENCRYPTION_KEY = 'datalake-faceauth-v1';
const PERSON_PREFIX = 'person:';
const EMBS_SUFFIX = ':embs';
const META_SUFFIX = ':enrolledAt';
const DIM = RECOGNITION.embeddingDim;

let _storage: MMKV | null = null;
const storage = (): MMKV => {
  if (!_storage) {
    _storage = createMMKV({ id: 'datalake-faceauth-gallery', encryptionKey: ENCRYPTION_KEY });
  }
  return _storage;
};

const embsKey = (personId: string): string => `${PERSON_PREFIX}${personId}${EMBS_SUFFIX}`;
const metaKey = (personId: string): string => `${PERSON_PREFIX}${personId}${META_SUFFIX}`;

function personIdsInStorage(): string[] {
  const ids = new Set<string>();
  for (const k of storage().getAllKeys()) {
    if (k.startsWith(PERSON_PREFIX) && k.endsWith(EMBS_SUFFIX)) {
      ids.add(k.slice(PERSON_PREFIX.length, k.length - EMBS_SUFFIX.length));
    }
  }
  return [...ids];
}

function readEmbeddings(personId: string): Embedding[] {
  const buf = storage().getBuffer(embsKey(personId));
  if (!buf) return [];
  const all = new Float32Array(buf);
  const count = Math.floor(all.length / DIM);
  const out: Embedding[] = [];
  for (let i = 0; i < count; i++) out.push(all.slice(i * DIM, (i + 1) * DIM));
  return out;
}

function writeEmbeddings(personId: string, embs: readonly Embedding[]): void {
  const merged = new Float32Array(embs.length * DIM);
  for (let i = 0; i < embs.length; i++) merged.set(embs[i]!, i * DIM);
  storage().set(embsKey(personId), merged.buffer);
}

export function addEnrollment(personId: string, embedding: Embedding): number {
  const existing = readEmbeddings(personId);
  existing.push(embedding);
  writeEmbeddings(personId, existing);
  if (storage().getNumber(metaKey(personId)) === undefined) {
    storage().set(metaKey(personId), Date.now());
  }
  return existing.length;
}

export function getGallery(): EnrolledPerson[] {
  return personIdsInStorage().map((personId) => ({
    personId,
    embeddings: readEmbeddings(personId),
    enrolledAt: storage().getNumber(metaKey(personId)) ?? 0,
  }));
}

export function listEnrolled(): string[] {
  return personIdsInStorage();
}

export function deletePerson(personId: string): boolean {
  const had = storage().contains(embsKey(personId));
  storage().remove(embsKey(personId));
  storage().remove(metaKey(personId));
  return had;
}

/** Wipe everything (the purgeLocal() primitive, §10). Returns count of people removed. */
export function purgeAll(): number {
  const n = personIdsInStorage().length;
  storage().clearAll();
  return n;
}
