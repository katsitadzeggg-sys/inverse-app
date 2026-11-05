'use client';

import QRCode from 'qrcode';

/**
 * Zebra labels (ZQ511 and other 203 dpi printers). Zebra's built-in fonts have
 * no Georgian letters, so each label is drawn on a canvas — QR code, inventory
 * number, name — turned into black and white dots and sent as one ZPL graphic
 * (^GFA). Whatever the browser can draw, the printer prints.
 */

export const DOTS_PER_MM = 8; // 203 dpi

export type LabelSize = { w: number; h: number }; // millimetres
export type LabelData = { code: string; title: string; footer?: string };

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) line = next;
    else {
      if (line) lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  // Shorten the last line with an ellipsis if text is left over.
  const last = lines.length - 1;
  if (last >= 0 && lines.join(' ').length < text.length) {
    while (lines[last].length > 1 && ctx.measureText(`${lines[last]}…`).width > maxWidth) lines[last] = lines[last].slice(0, -1);
    lines[last] += '…';
  }
  return lines;
}

/** Draws one label at printer resolution (1 canvas pixel = 1 printer dot). */
export function drawLabel(size: LabelSize, data: LabelData): HTMLCanvasElement {
  const W = Math.round(size.w * DOTS_PER_MM);
  const H = Math.round(size.h * DOTS_PER_MM);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';

  const pad = Math.round(2 * DOTS_PER_MM);
  const qr = QRCode.create(data.code, { errorCorrectionLevel: 'M' }).modules;
  const landscape = W / H >= 1.35;
  const font = (px: number, weight = 700) => `${weight} ${px}px -apple-system, "Noto Sans Georgian", "Segoe UI", sans-serif`;

  // QR: as large as the layout allows, whole dots per module so it scans crisp.
  const qrBox = landscape ? H - pad * 2 : Math.min(W - pad * 2, Math.round(H * 0.6));
  const mod = Math.max(1, Math.floor(qrBox / qr.size));
  const qrPx = mod * qr.size;
  const qrX = landscape ? pad : Math.round((W - qrPx) / 2);
  const qrY = landscape ? Math.round((H - qrPx) / 2) : pad;
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) if (qr.data[y * qr.size + x]) ctx.fillRect(qrX + x * mod, qrY + y * mod, mod, mod);
  }

  // Text: code (bold), title (up to 2 lines), footer (small).
  const tx = landscape ? qrX + qrPx + pad : pad;
  const tw = W - tx - pad;
  let ty = landscape ? pad : qrY + qrPx + Math.round(pad * 0.6);
  const room = H - ty - pad;
  let codeSize = Math.max(18, Math.min(Math.round(landscape ? H * 0.16 : room * 0.38), Math.round(W * 0.12)));
  ctx.font = font(codeSize);
  while (codeSize > 14 && ctx.measureText(data.code).width > tw) {
    codeSize = Math.round(codeSize * 0.9);
    ctx.font = font(codeSize);
  }
  ctx.textAlign = landscape ? 'left' : 'center';
  const ax = landscape ? tx : W / 2;
  ctx.fillText(data.code, ax, ty, tw);
  ty += Math.round(codeSize * 1.15);

  const small = Math.max(14, Math.round(codeSize * 0.62));
  ctx.font = font(small, 500);
  const titleLines = fitText(ctx, data.title, tw, landscape || room > codeSize * 3 ? 2 : 1);
  for (const l of titleLines) {
    if (ty + small > H - pad) break;
    ctx.fillText(l, ax, ty, tw);
    ty += Math.round(small * 1.15);
  }
  if (data.footer && ty + small * 0.8 <= H - pad) {
    ctx.font = font(Math.round(small * 0.8), 400);
    ctx.fillText(data.footer, ax, ty, tw);
  }
  return canvas;
}

/** One label as ZPL: the canvas turned into a 1-bit graphic field. */
export function canvasToZpl(canvas: HTMLCanvasElement): string {
  const { width: W, height: H } = canvas;
  const px = canvas.getContext('2d')!.getImageData(0, 0, W, H).data;
  const rowBytes = Math.ceil(W / 8);
  let hex = '';
  for (let y = 0; y < H; y++) {
    for (let b = 0; b < rowBytes; b++) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = b * 8 + bit;
        if (x < W) {
          const i = (y * W + x) * 4;
          const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          if (lum < 140) byte |= 0x80 >> bit;
        }
      }
      hex += byte.toString(16).padStart(2, '0').toUpperCase();
    }
  }
  const total = rowBytes * H;
  return `^XA^PW${W}^LL${H}^LH0,0^FO0,0^GFA,${total},${total},${rowBytes},${hex}^FS^PQ1^XZ\n`;
}

export function labelsToZpl(size: LabelSize, items: LabelData[]): string {
  return items.map((d) => canvasToZpl(drawLabel(size, d))).join('');
}
