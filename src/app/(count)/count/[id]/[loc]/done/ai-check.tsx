'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { aiCheckShelf, type AiResult } from '../../../ai-actions';

/** A few frames cut from a video in the browser (JPEG data URLs, long side ≤ 1024 px). */
async function videoFrames(url: string, count: number): Promise<string[]> {
  const v = document.createElement('video');
  v.crossOrigin = 'anonymous';
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  await new Promise<void>((ok, fail) => {
    v.onloadedmetadata = () => ok();
    v.onerror = () => fail(new Error('video'));
    setTimeout(() => fail(new Error('timeout')), 20000);
  });
  const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 1;
  const k = Math.min(1, 1024 / Math.max(v.videoWidth || 1024, v.videoHeight || 1024));
  const c = document.createElement('canvas');
  c.width = Math.round((v.videoWidth || 1024) * k);
  c.height = Math.round((v.videoHeight || 768) * k);
  const ctx = c.getContext('2d')!;
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = (d * (i + 0.5)) / count;
    await new Promise<void>((ok) => {
      v.onseeked = () => ok();
      v.currentTime = t;
      setTimeout(ok, 4000);
    });
    ctx.drawImage(v, 0, 0, c.width, c.height);
    out.push(c.toDataURL('image/jpeg', 0.7));
  }
  return out;
}

const mark = { match: '✓', partial: '?', mismatch: '⚠', unknown: '❓' } as const;
const tone = {
  match: 'text-match',
  partial: 'text-review',
  mismatch: 'text-mismatch',
  unknown: 'text-review',
} as const;

/**
 * Manager's check of a closed shelf by its photos and videos: the model counts
 * what it can see and marks where that differs from what was counted.
 */
export default function AiCheck({
  stocktakeId,
  locationId,
  videos,
  photos,
  last,
}: {
  stocktakeId: string;
  locationId: string;
  videos: string[];
  photos: number;
  last: { result: AiResult; at: string; images: number } | null;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  function run() {
    setMsg(videos.length ? 'ვიდეოებიდან კადრებს ვჭრი…' : 'ფოტოებს ვამოწმებ…');
    start(async () => {
      const frames: string[] = [];
      const per = Math.max(2, Math.min(6, Math.floor(16 / Math.max(1, videos.length))));
      let lost = 0;
      for (const url of videos) {
        try {
          frames.push(...(await videoFrames(url, per)));
        } catch {
          lost += 1;
        }
      }
      setMsg('ფოტოებს ვამოწმებ… (წუთამდე)');
      const r = await aiCheckShelf(stocktakeId, locationId, frames.slice(0, 16)).catch((e) => ({
        error: String(e).slice(0, 200),
      }));
      if (r.error) return setMsg(r.error);
      setMsg(lost ? `მზადაა. ${lost} ვიდეოდან კადრი ვერ ამოვიღე.` : null);
      router.refresh();
    });
  }

  const flagged = last?.result.items.filter((i) => i.status !== 'match').length ?? 0;
  return (
    <section className="grid gap-2 rounded-control border border-rule/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">🤖 ფოტოებით შემოწმება</p>
        <button
          type="button"
          onClick={run}
          disabled={pending || photos + videos.length === 0}
          className="rounded-control bg-ink px-4 py-2 text-base font-semibold text-paper disabled:opacity-50"
        >
          {pending ? '…' : last ? '↻ თავიდან' : `შეამოწმე (${photos} ფოტო, ${videos.length} ვიდეო)`}
        </button>
      </div>
      {msg && <p className="text-sm">{msg}</p>}
      {last && (
        <>
          <p className="text-sm text-ink-soft">
            {new Date(last.at).toLocaleString('ka-GE', { timeZone: 'Asia/Tbilisi' })} ·{' '}
            {last.images} კადრი · {flagged ? `⚠ გადასამოწმებელი: ${flagged}` : '✓ ყველა ემთხვევა'}
            {last.result.quality === 'poor' && ' · ფოტოები ცუდი ხარისხისაა'}
          </p>
          <p className="text-sm">{last.result.summary}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-faint">
                  <th className="py-1 pr-2" />
                  <th className="py-1 pr-2">პროდუქტი</th>
                  <th className="py-1 pr-2 text-right">დათვლილი</th>
                  <th className="py-1 pr-2 text-right">ფოტოზე</th>
                  <th className="py-1">შენიშვნა</th>
                </tr>
              </thead>
              <tbody>
                {last.result.items.map((i, n) => (
                  <tr key={n} className="border-t border-rule/50 align-top">
                    <td className={`py-1 pr-2 font-semibold ${tone[i.status]}`}>
                      {mark[i.status]}
                    </td>
                    <td className="py-1 pr-2">
                      {i.name}
                      {i.code && <span className="block text-xs text-ink-faint">{i.code}</span>}
                    </td>
                    <td className="py-1 pr-2 text-right tabular-nums">{i.counted ?? '—'}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">
                      {i.detected}
                      <span className="block text-xs text-ink-faint">
                        {Math.round(i.confidence * 100)}%
                      </span>
                    </td>
                    <td className="py-1 text-xs text-ink-soft">
                      {i.needsBarcode && 'მსგავსი პროდუქტებია, ბარკოდით გადაამოწმე. '}
                      {i.notes}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-ink-faint">
            ✓ ემთხვევა · ⚠ ფოტოზე სხვა რაოდენობა ჩანს · ? ფოტოდან ზუსტად ვერ ითქმის. ფოტოზე მხოლოდ
            წინა რიგი ჩანს — ⚠ ნიშნავს „გადაამოწმე“, არა „შეცდომაა“.
          </p>
        </>
      )}
    </section>
  );
}
