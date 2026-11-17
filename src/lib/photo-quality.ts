/**
 * A quick look at a shelf photo on the phone, right after it is taken: too
 * blurred, too dark or too bright to be checked later. Runs in the browser
 * (no upload, no AI): the photo is shrunk to 320 px, turned grey, and the
 * sharpness is the variance of its Laplacian (edges); light is the mean grey.
 * The thresholds are a first guess, to be tuned on real warehouse photos —
 * the counter can always keep a photo anyway.
 */
export type PhotoQuality = { ok: true } | { ok: false; reason: string };

const BLUR_MIN = 40; // Laplacian variance below this: blurred
const DARK_MAX = 45; // mean grey below this: too dark
const BRIGHT_MIN = 235; // mean grey above this: washed out

export async function photoQuality(file: Blob): Promise<PhotoQuality> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    return { ok: true }; // cannot read it here: do not block the counter
  }
  const w = 320;
  const h = Math.max(1, Math.round((bmp.height / bmp.width) * w));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { ok: true };
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const px = ctx.getImageData(0, 0, w, h).data;
  const grey = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0; i < w * h; i++) {
    const g = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    grey[i] = g;
    sum += g;
  }
  const mean = sum / (w * h);
  if (mean < DARK_MAX) return { ok: false, reason: 'ფოტო ძალიან ბნელია' };
  if (mean > BRIGHT_MIN) return { ok: false, reason: 'ფოტო ძალიან ღიაა (გადაწვა)' };
  // Laplacian: 4·centre − the four neighbours.
  let n = 0;
  let m = 0;
  let m2 = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = 4 * grey[i] - grey[i - 1] - grey[i + 1] - grey[i - w] - grey[i + w];
      n++;
      m += l;
      m2 += l * l;
    }
  const variance = m2 / n - (m / n) ** 2;
  if (variance < BLUR_MIN) return { ok: false, reason: 'ფოტო ბუნდოვანია' };
  return { ok: true };
}
