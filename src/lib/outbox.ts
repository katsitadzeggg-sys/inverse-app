'use client';

/**
 * Offline outbox for the counter's phone.
 *
 * In a basement or a warehouse there is often no signal. Whatever the counter
 * saves then — an asset record, its photos and videos — goes into IndexedDB on
 * the phone and is sent, in order, as soon as the connection is back (or the
 * app is opened again). An asset saved offline gets a temporary id
 * ("local:…"); its photos wait for the real id before they are attached.
 *
 * The register of a stocktake is kept here too, so labels can still be
 * looked up with no connection.
 */

import { createClient } from '@/lib/supabase/client';
import { resumableUpload } from '@/lib/resumable-upload';
import { saveAssetCheck } from '@/app/(count)/count/assets-actions';
import { addEntry, type EntryInput, type ProductHit } from '@/app/(count)/count/actions';
import type { AssetHit } from '@/app/(count)/count/assets-actions';

type AssetInput = Parameters<typeof saveAssetCheck>[2];

export type CheckJob = {
  key: string; // "local:<uuid>" — the temporary record id
  type: 'check';
  stocktakeId: string;
  locationId: string;
  input: AssetInput;
  at: number;
};

export type MediaJob = {
  key: string;
  type: 'media';
  checkId: string; // real id, or the "local:" id of a check still waiting
  path: string;
  posterPath: string | null;
  blob: Blob;
  poster: Blob | null;
  contentType: string;
  row: Record<string, unknown>; // stocktake_media row, minus asset_check_id
  at: number;
};

/** Stock: a counted line saved with no connection. */
export type EntryJob = {
  key: string;
  type: 'entry';
  stocktakeId: string;
  locationId: string;
  input: EntryInput;
  at: number;
};

type Job = CheckJob | MediaJob | EntryJob;

const DB = 'inverse-outbox';
const JOBS = 'jobs';
const IDS = 'ids'; // "local:…" → real record id
const REG = 'register'; // stocktake id → AssetHit[]

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore(JOBS, { keyPath: 'key' });
      db.createObjectStore(IDS);
      db.createObjectStore(REG);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? (req.result as T) : undefined);
    t.onerror = () => reject(t.error);
  });
}

const listeners = new Set<() => void>();
function changed() {
  for (const l of listeners) l();
}

/** Re-render on queue changes (pending count, syncing). */
export function onOutbox(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export async function pendingJobs(): Promise<Job[]> {
  try {
    const all = (await tx<Job[]>(JOBS, 'readonly', (s) => s.getAll())) ?? [];
    return all.sort((a, b) => a.at - b.at);
  } catch {
    return [];
  }
}

/** Assets saved offline in this room and not yet sent. */
export async function pendingInRoom(locationId: string): Promise<number> {
  return (await pendingJobs()).filter((j) => j.type === 'check' && j.locationId === locationId)
    .length;
}

/** A failure that means "no connection" rather than a refusal from the server. */
export function isOffline(e?: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const msg =
    e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e ?? '');
  return /failed to fetch|load failed|networkerror|network request failed|fetch failed|internet connection/i.test(
    msg,
  );
}

export async function queueCheck(
  stocktakeId: string,
  locationId: string,
  input: AssetInput,
): Promise<string> {
  const key = `local:${crypto.randomUUID()}`;
  await tx(JOBS, 'readwrite', (s) =>
    s.put({
      key,
      type: 'check',
      stocktakeId,
      locationId,
      input,
      at: Date.now(),
    } satisfies CheckJob),
  );
  changed();
  return key;
}

export async function queueEntry(
  stocktakeId: string,
  locationId: string,
  input: EntryInput,
): Promise<void> {
  await tx(JOBS, 'readwrite', (s) =>
    s.put({
      key: `entry:${crypto.randomUUID()}`,
      type: 'entry',
      stocktakeId,
      locationId,
      input,
      at: Date.now(),
    } satisfies EntryJob),
  );
  changed();
}

/** Stock lines of this shelf waiting to be sent (product → qty), for "already counted". */
export async function pendingEntries(locationId: string): Promise<EntryJob[]> {
  return (await pendingJobs()).filter(
    (j): j is EntryJob => j.type === 'entry' && j.locationId === locationId,
  );
}

/** The product list, kept on the phone for lookups without a connection. */
export async function keepCatalog(rows: ProductHit[]): Promise<void> {
  try {
    await tx(REG, 'readwrite', (s) => s.put(rows, 'products'));
  } catch {}
}

export async function storedCatalog(): Promise<ProductHit[]> {
  try {
    return ((await tx<ProductHit[]>(REG, 'readonly', (s) => s.get('products'))) ??
      []) as ProductHit[];
  } catch {
    return [];
  }
}

export async function queueMedia(job: Omit<MediaJob, 'key' | 'type' | 'at'>): Promise<void> {
  await tx(JOBS, 'readwrite', (s) =>
    s.put({
      ...job,
      key: `media:${crypto.randomUUID()}`,
      type: 'media',
      at: Date.now(),
    } satisfies MediaJob),
  );
  changed();
}

/** The register, kept on the phone for lookups without a connection. */
export async function keepRegister(stocktakeId: string, rows: AssetHit[]): Promise<void> {
  try {
    await tx(REG, 'readwrite', (s) => s.put(rows, stocktakeId));
  } catch {}
}

export async function storedRegister(stocktakeId: string): Promise<AssetHit[]> {
  try {
    return ((await tx<AssetHit[]>(REG, 'readonly', (s) => s.get(stocktakeId))) ?? []) as AssetHit[];
  } catch {
    return [];
  }
}

let running: Promise<void> | null = null;
let syncing = false;
export const isSyncing = () => syncing;

/** Sends everything waiting, oldest first. Stops at the first network failure. */
export function flushOutbox(): Promise<void> {
  if (running) return running;
  running = (async () => {
    const jobs = await pendingJobs();
    if (!jobs.length || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    syncing = true;
    changed();
    const supabase = createClient();
    try {
      for (const job of jobs) {
        if (job.type === 'entry') {
          const res = await addEntry(job.stocktakeId, job.locationId, job.input);
          if (res.error) console.warn('outbox: entry refused', res.error);
        } else if (job.type === 'check') {
          const res = await saveAssetCheck(job.stocktakeId, job.locationId, job.input);
          if (res.error || !res.id) {
            // Refused by the server (not a network problem): drop it rather than block the queue.
            console.warn('outbox: check refused', res.error);
          } else {
            await tx(IDS, 'readwrite', (s) => s.put(res.id, job.key));
          }
        } else {
          let checkId: string | null = job.checkId || null; // '' = shelf photo, no asset
          if (checkId?.startsWith('local:')) {
            checkId =
              ((await tx<string>(IDS, 'readonly', (s) => s.get(job.checkId))) as
                string | undefined) ?? null;
            if (!checkId) continue; // its record has not gone through yet
          }
          if (job.blob.size > 6 * 1048576) {
            await resumableUpload(
              supabase,
              'stocktake-media',
              job.path,
              new File([job.blob], job.path.split('/').pop()!, { type: job.contentType }),
              () => {},
            );
          } else {
            const { error } = await supabase.storage
              .from('stocktake-media')
              .upload(job.path, job.blob, { contentType: job.contentType, upsert: true });
            if (error) throw error;
          }
          let posterPath = job.posterPath;
          if (job.poster && posterPath) {
            const { error } = await supabase.storage
              .from('stocktake-media')
              .upload(posterPath, job.poster, { contentType: 'image/jpeg', upsert: true });
            if (error) posterPath = null;
          }
          const { error: rowErr } = await supabase
            .from('stocktake_media')
            .insert({ ...job.row, poster_path: posterPath, asset_check_id: checkId });
          if (rowErr) throw rowErr;
        }
        await tx(JOBS, 'readwrite', (s) => s.delete(job.key));
        changed();
      }
    } catch (e) {
      console.warn('outbox: stopped', e);
    } finally {
      syncing = false;
      running = null;
      changed();
    }
  })();
  return running;
}
