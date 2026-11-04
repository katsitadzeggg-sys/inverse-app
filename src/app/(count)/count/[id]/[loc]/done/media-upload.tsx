'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';

type Item = { id: string; path: string; kind: 'photo' | 'video'; url: string };

/**
 * Photos and videos of the shelf. Files go straight from the phone to the
 * private stocktake-media bucket (videos are too big for a form post), then a
 * row records them against this shelf.
 */
export default function MediaUpload({
  stocktakeId,
  locationId,
  companyId,
  userId,
  items,
}: {
  stocktakeId: string;
  locationId: string;
  companyId: string;
  userId: string;
  items: Item[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(files: FileList) {
    setError(null);
    const list = Array.from(files);
    try {
      const supabase = createClient();
      let i = 0;
      for (const file of list) {
        i += 1;
        setBusy(`იტვირთება ${i} / ${list.length}…`);
        const kind = file.type.startsWith('video/') ? 'video' : 'photo';
        const ext = (
          file.name.split('.').pop() || (kind === 'video' ? 'mp4' : 'jpg')
        ).toLowerCase();
        const path = `${companyId}/${stocktakeId}/${locationId}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('stocktake-media')
          .upload(path, file, { contentType: file.type || undefined });
        if (upErr) {
          setError(
            upErr.message.includes('size') ? 'ფაილი ძალიან დიდია (მაქს. 100 MB).' : upErr.message,
          );
          continue;
        }
        const { error: rowErr } = await supabase.from('stocktake_media').insert({
          company_id: companyId,
          stocktake_id: stocktakeId,
          location_id: locationId,
          path,
          kind,
          created_by: userId,
        });
        if (rowErr) setError(rowErr.message);
      }
    } catch (e) {
      // Never fail silently: show what went wrong on the phone.
      setError(`ვერ აიტვირთა: ${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy(null);
    router.refresh();
  }

  return (
    <section className="grid gap-2">
      <label className="cursor-pointer rounded-control border border-rule-strong bg-paper-sunk px-4 py-3 text-center text-base font-semibold">
        📷 ფოტო / ვიდეო
        <input
          type="file"
          accept="image/*,video/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) upload(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
      {busy && <p className="text-center text-sm text-ink-soft">{busy}</p>}
      {error && <p className="text-sm text-mismatch">{error}</p>}
      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {items.map((m) =>
            m.kind === 'video' ? (
              <video
                key={m.id}
                src={m.url}
                controls
                playsInline
                className="aspect-square w-full rounded-control bg-black object-cover"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={m.id}
                src={m.url}
                alt=""
                className="aspect-square w-full rounded-control object-cover"
              />
            ),
          )}
        </div>
      )}
    </section>
  );
}
