'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { currentPosition } from '@/lib/geo';
import { captionLines, captionPhoto, videoPoster } from '@/lib/caption';

type Item = { id: string; path: string; kind: 'photo' | 'video'; url: string; poster: string | null };

/**
 * Photos and videos of the shelf, captured live with the phone camera only
 * (no gallery). Each photo gets a caption strip burned in: date and time, who
 * shot it, company / branch, shelf and GPS. A video goes up as the camera
 * recorded it, with a captioned poster frame next to it. The same details are
 * stored on the row.
 */
export default function MediaUpload({
  stocktakeId,
  locationId,
  companyId,
  userId,
  author,
  company,
  branch,
  shelf,
  items,
}: {
  stocktakeId: string;
  locationId: string;
  companyId: string;
  userId: string;
  author: string;
  company: string;
  branch: string | null;
  shelf: string;
  items: Item[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File, kind: 'photo' | 'video') {
    setError(null);
    try {
      setBusy('ვიღებ მდებარეობას…');
      const pos = await currentPosition(6000);
      const when = new Date();
      const lines = captionLines({ when, author, company, branch, shelf: `თარო ${shelf}`, pos });
      const supabase = createClient();
      const base = `${companyId}/${stocktakeId}/${locationId}/${crypto.randomUUID()}`;
      let path: string;
      let posterPath: string | null = null;

      if (kind === 'photo') {
        setBusy('ვაწერ თარიღს და ლოკაციას…');
        const stamped = await captionPhoto(file, lines);
        path = `${base}.jpg`;
        setBusy('იტვირთება…');
        const { error: e } = await supabase.storage.from('stocktake-media').upload(path, stamped, { contentType: 'image/jpeg' });
        if (e) throw e;
      } else {
        const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
        path = `${base}.${ext}`;
        setBusy(`ვიდეო იტვირთება (${Math.round(file.size / 1048576)} MB)…`);
        const { error: e } = await supabase.storage
          .from('stocktake-media')
          .upload(path, file, { contentType: file.type || 'video/mp4' });
        if (e) throw e;
        try {
          setBusy('ვამზადებ ვიდეოს გარეკანს…');
          const poster = await videoPoster(file, lines);
          posterPath = `${base}.poster.jpg`;
          const { error: pe } = await supabase.storage.from('stocktake-media').upload(posterPath, poster, { contentType: 'image/jpeg' });
          if (pe) posterPath = null;
        } catch {
          posterPath = null; // The video itself is saved; the poster is a bonus.
        }
      }

      const { error: rowErr } = await supabase.from('stocktake_media').insert({
        company_id: companyId,
        stocktake_id: stocktakeId,
        location_id: locationId,
        path,
        kind,
        created_by: userId,
        caption: lines.join('\n'),
        taken_at: when.toISOString(),
        lat: pos?.lat ?? null,
        lng: pos?.lng ?? null,
        accuracy_m: pos?.accuracy ?? null,
        poster_path: posterPath,
      });
      if (rowErr) throw rowErr;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e);
      setError(msg.includes('size') || msg.includes('large') ? 'ფაილი ძალიან დიდია (მაქს. 100 MB). გადაიღე უფრო მოკლე ვიდეო.' : `ვერ აიტვირთა: ${msg}`);
    }
    setBusy(null);
    router.refresh();
  }

  const button = 'cursor-pointer rounded-control border border-rule-strong bg-paper-sunk px-4 py-3 text-center text-base font-semibold';

  return (
    <section className="grid gap-2">
      <div className="grid grid-cols-2 gap-2">
        <label className={button}>
          📷 ფოტო
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            disabled={!!busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) upload(f, 'photo');
            }}
          />
        </label>
        <label className={button}>
          🎥 ვიდეო
          <input
            type="file"
            accept="video/*"
            capture="environment"
            className="hidden"
            disabled={!!busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) upload(f, 'video');
            }}
          />
        </label>
      </div>
      <p className="text-center text-xs text-ink-faint">მხოლოდ კამერით. ფოტოს ეწერება თარიღი, შენი სახელი და ლოკაცია.</p>
      {busy && <p className="text-center text-sm text-ink-soft">{busy}</p>}
      {error && <p className="text-sm text-mismatch">{error}</p>}
      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {items.map((m) =>
            m.kind === 'video' ? (
              <video
                key={m.id}
                src={m.url}
                poster={m.poster ?? undefined}
                controls
                playsInline
                preload="none"
                className="aspect-square w-full rounded-control bg-black object-cover"
              />
            ) : (
              <a key={m.id} href={m.url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.url} alt="" className="aspect-square w-full rounded-control object-cover" />
              </a>
            ),
          )}
        </div>
      )}
    </section>
  );
}
