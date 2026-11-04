'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAnonKey, supabaseUrl } from '@/lib/env';

/** The project's per-file limit (Supabase Free plan: 50 MB). */
export const MAX_UPLOAD_MB = 50;

/**
 * Uploads a large file (a video) to Supabase Storage in 6 MB parts with the
 * TUS protocol. A dropped connection resumes from the last part instead of
 * starting over, which matters on a weak warehouse signal.
 */
export async function resumableUpload(
  supabase: SupabaseClient,
  bucket: string,
  path: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  const { Upload } = await import('tus-js-client');
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('სესია ამოიწურა, შედი თავიდან.');
  const host = new URL(supabaseUrl()).hostname.replace('.supabase.co', '.storage.supabase.co');

  await new Promise<void>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint: `https://${host}/storage/v1/upload/resumable`,
      retryDelays: [0, 2000, 5000, 10000, 20000, 30000],
      headers: { authorization: `Bearer ${session.access_token}`, apikey: supabaseAnonKey(), 'x-upsert': 'false' },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: 6 * 1024 * 1024, // Supabase requires exactly 6 MB parts
      metadata: { bucketName: bucket, objectName: path, contentType: file.type || 'video/mp4', cacheControl: '3600' },
      onError: (e) => reject(e),
      onProgress: (sent, total) => onProgress(Math.round((sent / total) * 100)),
      onSuccess: () => resolve(),
    });
    // Resume an earlier attempt of the same file if the browser remembers one.
    upload.findPreviousUploads().then((previous) => {
      if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
      upload.start();
    });
  });
}
