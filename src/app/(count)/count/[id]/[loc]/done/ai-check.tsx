'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { aiCheckShelf, AiResult } from '../../../ai-actions';
import ShelfHud from './shelf-hud';

/**
 * Runs the shelf check through /api/ai-check, not as a server action, so the
 * page's other buttons (closing the shelf) do not wait for it.
 */
export async function requestAiCheck(
  stocktakeId: string,
  locationId: string,
  frames: string[],
  auto = false,
): ReturnType<typeof aiCheckShelf> {
  const res = await fetch('/api/ai-check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stocktakeId, locationId, frames, auto }),
  });
  if (!res.ok) return { error: `შემოწმება ვერ მოხერხდა (${res.status})` };
  return res.json();
}

/**
 * A few frames cut from a video in the browser (JPEG data URLs, long side ≤
 * 1024 px). iPhone Safari draws a black frame from a video it has not
 * started decoding, or right after a seek before the frame is painted: the
 * video is played and paused once first, each seek waits for the painted
 * frame, and a frame that is still black is tried again a little later or
 * left out (25.11: "images 6–9 are black").
 */
export async function videoFrames(url: string, count: number): Promise<string[]> {
  const v = document.createElement('video');
  v.crossOrigin = 'anonymous';
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  await new Promise<void>((ok, fail) => {
    v.onloadeddata = () => ok();
    v.onerror = () => fail(new Error('video'));
    setTimeout(() => fail(new Error('timeout')), 20000);
  });
  try {
    await v.play();
    v.pause();
  } catch {
    // Autoplay refused: seeking still works on most browsers.
  }
  const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 1;
  const k = Math.min(1, 1280 / Math.max(v.videoWidth || 1280, v.videoHeight || 1280));
  const c = document.createElement('canvas');
  c.width = Math.round((v.videoWidth || 1024) * k);
  c.height = Math.round((v.videoHeight || 768) * k);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const painted = () =>
    new Promise<void>((ok) => {
      const rvfc = (
        v as HTMLVideoElement & {
          requestVideoFrameCallback?: (cb: () => void) => number;
        }
      ).requestVideoFrameCallback;
      if (rvfc) rvfc.call(v, () => ok());
      setTimeout(ok, 250);
    });
  const seek = (t: number) =>
    new Promise<void>((ok) => {
      v.onseeked = () => ok();
      v.currentTime = Math.min(Math.max(0, t), Math.max(0, d - 0.05));
      setTimeout(ok, 4000);
    });
  // Mean brightness of a frame, from a 16 × 16 sample.
  const dark = () => {
    const s = document.createElement('canvas');
    s.width = s.height = 16;
    const sc = s.getContext('2d', { willReadFrequently: true })!;
    sc.drawImage(c, 0, 0, 16, 16);
    const px = sc.getImageData(0, 0, 16, 16).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
    return sum / (px.length / 4) / 3 < 10;
  };
  // Sharpness of the frame on the canvas: mean squared difference between
  // neighbouring pixels of a small grey copy. A moving phone gives a smeared
  // frame (low value); a still moment gives a sharp one.
  const sharp = () => {
    const w = 160;
    const h = Math.max(1, Math.round((c.height / c.width) * w));
    const s = document.createElement('canvas');
    s.width = w;
    s.height = h;
    const sc = s.getContext('2d', { willReadFrequently: true })!;
    sc.drawImage(c, 0, 0, w, h);
    const px = sc.getImageData(0, 0, w, h).data;
    const g = (x: number, y: number) => {
      const i = (y * w + x) * 4;
      return px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11;
    };
    let sum = 0;
    for (let y = 0; y < h - 1; y++)
      for (let x = 0; x < w - 1; x++) {
        const a = g(x, y);
        sum += (a - g(x + 1, y)) ** 2 + (a - g(x, y + 1)) ** 2;
      }
    return sum / (w * h);
  };
  // Around each moment, the sharpest of five nearby frames (not a dark one).
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = (d * (i + 0.5)) / count;
    let best: { score: number; url: string } | null = null;
    for (const offset of [0, -0.2, 0.2, -0.4, 0.4]) {
      await seek(t + offset);
      await painted();
      ctx.drawImage(v, 0, 0, c.width, c.height);
      if (dark()) continue;
      const score = sharp();
      if (!best || score > best.score) best = { score, url: c.toDataURL('image/jpeg', 0.82) };
    }
    if (best) out.push(best.url);
  }
  v.removeAttribute('src');
  v.load();
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
  last: stored,
  urls,
}: {
  stocktakeId: string;
  locationId: string;
  videos: string[];
  photos: number;
  last: { result: AiResult; at: string; images: number } | null;
  /** Signed URL per storage path, to draw the AI's frames on the photos. */
  urls: Record<string, string>;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  // A counter cannot read stored checks: their own run is shown from its answer.
  const [fresh, setFresh] = useState<{ result: AiResult; at: string; images: number } | null>(null);
  // Signed URLs of the video frames this run stored (the page signs them on reload).
  const [frameUrls, setFrameUrls] = useState<Record<string, string>>({});
  const [focus, setFocus] = useState<number | null>(null);
  const last = fresh ?? stored;

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
      const r = await requestAiCheck(stocktakeId, locationId, frames.slice(0, 16)).catch((e) => ({
        error: String(e).slice(0, 200),
        result: undefined,
      }));
      if (r.error) return setMsg(r.error);
      if ('frameUrls' in r && r.frameUrls) setFrameUrls(r.frameUrls);
      if (r.result)
        setFresh({
          result: r.result,
          at: new Date().toISOString(),
          images: photos + frames.length,
        });
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
          <ShelfHud result={last.result} urls={{ ...urls, ...frameUrls }} focus={focus} />
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
                  <tr
                    key={n}
                    onClick={() => {
                      const img = i.boxes?.[0]?.image;
                      if (img == null) return;
                      setFocus(n);
                      document
                        .getElementById(`ai-img-${img}`)
                        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }}
                    title={i.boxes?.length ? 'ფოტოზე ჩვენება' : undefined}
                    className={`border-t border-rule/50 align-top ${i.boxes?.length ? 'cursor-pointer hover:bg-paper-sunk' : ''} ${focus === n ? 'bg-paper-sunk' : ''}`}
                  >
                    <td className={`py-1 pr-2 font-semibold ${tone[i.status]}`}>
                      {mark[i.status]}
                    </td>
                    <td className="py-1 pr-2">
                      {i.name}
                      {i.code && <span className="block text-xs text-ink-faint">{i.code}</span>}
                      {i.boxes?.length ? (
                        <button
                          type="button"
                          className="mt-1 inline-flex items-center gap-1 rounded-full border border-sky-500/60 px-2.5 py-0.5 text-xs font-medium text-sky-500 hover:bg-sky-500/10"
                        >
                          🔍 მოძებნე ფოტოზე
                          <span className="text-ink-faint">
                            ({[...new Set(i.boxes.map((b) => b.image + 1))].join(', ')})
                          </span>
                        </button>
                      ) : null}
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
