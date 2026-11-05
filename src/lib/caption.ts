'use client';

/**
 * Burns a caption strip (when, who, where) into a photo, or into a poster
 * frame taken from a video. Runs in the phone's browser on a canvas, so the
 * picture leaves the phone already stamped.
 */

export type CaptionInfo = {
  when: Date;
  author: string;
  company: string;
  branch?: string | null;
  shelf: string;
  pos: { lat: number; lng: number; accuracy: number } | null;
  extra?: string | null;
};

export function captionLines(c: CaptionInfo): string[] {
  const date = c.when.toLocaleDateString('ka-GE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = c.when.toLocaleTimeString('ka-GE', { hour: '2-digit', minute: '2-digit' });
  const lines = [
    `${date} ${time} · ${c.author}`,
    `${c.company}${c.branch ? ` / ${c.branch}` : ''} · ${c.shelf}`,
    c.pos
      ? `GPS ${c.pos.lat.toFixed(5)}, ${c.pos.lng.toFixed(5)} (±${Math.round(c.pos.accuracy)} მ)`
      : 'GPS: მდებარეობა არ ჩაიწერა',
  ];
  if (c.extra) lines.push(c.extra);
  return lines;
}

function burn(source: CanvasImageSource, w: number, h: number, lines: string[], maxSide = 2560): Promise<Blob> {
  const scale = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.round(w * scale);
  const ch = Math.round(h * scale);
  const font = Math.max(16, Math.round(Math.min(cw, ch) * 0.032));
  const pad = Math.round(font * 0.6);
  const strip = lines.length * Math.round(font * 1.35) + pad * 2;

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch + strip;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('canvas'));
  ctx.drawImage(source, 0, 0, cw, ch);
  // The strip sits under the picture, so it never covers what was shot.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, ch, cw, strip);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'top';
  ctx.font = `600 ${font}px -apple-system, "Noto Sans Georgian", "Segoe UI", sans-serif`;
  lines.forEach((line, i) => {
    if (i === 1) ctx.font = `400 ${font}px -apple-system, "Noto Sans Georgian", "Segoe UI", sans-serif`;
    ctx.fillText(line, pad, ch + pad + i * Math.round(font * 1.35), cw - pad * 2);
  });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', 0.88),
  );
}

/** The photo with the caption strip under it, as a JPEG. */
export async function captionPhoto(file: Blob, lines: string[]): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    // Browsers apply the EXIF rotation when an <img> is drawn to a canvas.
    return await burn(img, img.naturalWidth, img.naturalHeight, lines);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A frame from the start of the video with the caption strip, as a JPEG. */
export async function videoPoster(file: Blob, lines: string[]): Promise<Blob> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  video.preload = 'auto';
  // iPhone Safari decodes frames only for a video that is in the page and has
  // played; keep it tiny and out of sight.
  video.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.appendChild(video);
  video.src = url;
  video.load();
  const wait = (ev: string, ms: number) =>
    new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), ms);
      video.addEventListener(ev, () => {
        clearTimeout(t);
        resolve(true);
      }, { once: true });
    });
  try {
    if (video.readyState < 1 && !(await wait('loadedmetadata', 10000))) throw new Error('video metadata');
    // A short play makes Safari produce a picture; then stop on an early frame.
    await video.play().catch(() => {});
    if (video.readyState < 2) await wait('loadeddata', 5000);
    video.pause();
    const at = Math.min(0.5, (video.duration || 1) / 2);
    if (Math.abs(video.currentTime - at) > 0.05) {
      video.currentTime = at;
      await wait('seeked', 3000);
    }
    if (!video.videoWidth || !video.videoHeight) throw new Error('video size');
    return await burn(video, video.videoWidth, video.videoHeight, lines, 1600);
  } finally {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  }
}
