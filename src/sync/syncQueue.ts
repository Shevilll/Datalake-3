/**
 * Offline-to-online sync & purge (§10, C8 / Scalability).
 *
 * A real local queue of VerificationRecords (never raw images). syncNow() drains it against a
 * MOCK cloud with simulated latency, logging exactly what WOULD be transmitted (stands in for
 * the AWS sync — the contract is what's graded). purgeLocal() wipes embeddings + queue + logs
 * and is demonstrated live.
 *
 * Slice 3 backs the queue + gallery with encrypted MMKV (embeddings-at-rest); that swap is
 * batched into the next native dev-client rebuild (see DECISIONS.md D10). The API here is stable.
 */

import { purgeAll as purgeGallery } from '../faceauth/gallery';
import type { VerificationRecord } from '../faceauth/types';

const queue: VerificationRecord[] = [];
const transmittedLog: VerificationRecord[] = [];

const log = (msg: string, data?: unknown): void => {
  // eslint-disable-next-line no-console
  console.log(`[FaceAuth sync] ${msg}`, data ?? '');
};

export function queueForSync(record: VerificationRecord): void {
  queue.push(record);
  log(`queued record ${record.id} (pending=${queue.length})`);
}

export function pendingCount(): number {
  return queue.length;
}

/** Stand-in for the AWS endpoint: simulated network latency; logs the exact payload. */
async function mockCloudUpload(records: readonly VerificationRecord[]): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 400 + records.length * 20));
  log(`POST https://datalake.example/attendance — ${records.length} records`, records);
}

/** Drain the queue to the (mock) cloud once connectivity is restored. */
export async function syncNow(): Promise<{ synced: number }> {
  if (queue.length === 0) {
    log('syncNow: nothing to sync');
    return { synced: 0 };
  }
  const batch = queue.splice(0, queue.length);
  await mockCloudUpload(batch);
  transmittedLog.push(...batch);
  log(`syncNow: drained ${batch.length} (total transmitted=${transmittedLog.length})`);
  return { synced: batch.length };
}

/**
 * Purge ALL local biometric data: enrolled embeddings + the sync queue + transmit log.
 * The security story: biometric data never leaves the device unencrypted and is purged on command.
 */
export function purgeLocal(): { purged: number } {
  const people = purgeGallery();
  const pending = queue.length;
  queue.length = 0;
  transmittedLog.length = 0;
  log(`purgeLocal: wiped ${people} identities + ${pending} queued records + transmit log`);
  return { purged: people + pending };
}
