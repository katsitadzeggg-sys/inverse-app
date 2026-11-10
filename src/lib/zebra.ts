'use client';

import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';

/**
 * Zebra labels (ZQ511 and other 203 dpi printers). Zebra's built-in fonts have
 * no Georgian letters, so each label is drawn on a canvas — QR code, inventory
 * number, name — turned into black and white dots and sent as one ZPL graphic
 * (^GFA). Whatever the browser can draw, the printer prints.
 */

export const DOTS_PER_MM = 8; // 203 dpi

export type LabelSize = { w: number; h: number }; // millimetres
/**
 * qr — QR code + text (shelves); barcode — a line barcode (products);
 * both — QR and a line barcode (inventory numbers, readable by any scanner).
 */
export type LabelMode = 'qr' | 'barcode' | 'both';
export type LabelData = { code: string; title: string; footer?: string; mode?: LabelMode };

/**
 * Bars of a line barcode as "1010…" (1 = black module). EAN-13 / EAN-8 when
 * the code is a valid EAN, otherwise Code 128. Null when the code has
 * characters a barcode cannot carry (e.g. Georgian letters).
 */
export function barcodeBits(code: string): string | null {
  const formats = /^\d{13}$/.test(code)
    ? ['EAN13', 'CODE128']
    : /^\d{8}$/.test(code)
      ? ['EAN8', 'CODE128']
      : ['CODE128'];
  for (const format of formats) {
    const out: { encodings?: { data: string }[] } = {};
    let ok = true;
    try {
      JsBarcode(out as never, code, { format, valid: (v: boolean) => (ok = v) });
    } catch {
      ok = false;
    }
    if (ok && out.encodings?.length) return out.encodings.map((e) => e.data).join('');
  }
  return null;
}

/** Draws bars into the box, whole dots per module so every scanner reads it. */
function drawBars(
  ctx: CanvasRenderingContext2D,
  bits: string,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const quiet = 10; // modules of white on each side
  const mod = Math.max(1, Math.floor(w / (bits.length + quiet * 2)));
  const px = mod * bits.length;
  const left = x + Math.round((w - px) / 2);
  for (let i = 0; i < bits.length; i++)
    if (bits[i] === '1') ctx.fillRect(left + i * mod, y, mod, h);
}

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
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
    while (lines[last].length > 1 && ctx.measureText(`${lines[last]}…`).width > maxWidth)
      lines[last] = lines[last].slice(0, -1);
    lines[last] += '…';
  }
  return lines;
}

const font = (px: number, weight = 700) =>
  `${weight} ${px}px -apple-system, "Noto Sans Georgian", "Segoe UI", sans-serif`;

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
  const mode = data.mode ?? 'qr';
  const bits = mode === 'qr' ? null : barcodeBits(data.code);
  if (mode === 'barcode') {
    drawBarcodeLabel(ctx, W, H, pad, data, bits);
    return canvas;
  }
  // "both": a strip of bars along the bottom, QR + text above it.
  const strip = bits ? Math.round(H * (W / H >= 1.35 ? 0.3 : 0.24)) : 0;
  if (bits) drawBars(ctx, bits, pad, H - pad - strip, W - pad * 2, strip);
  drawQrLabel(ctx, W, H - (strip ? strip + Math.round(pad * 0.5) : 0), pad, data);
  return canvas;
}

/** Product label: name on top, bars in the middle, digits under the bars. */
function drawBarcodeLabel(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  pad: number,
  data: LabelData,
  bits: string | null,
) {
  const tw = W - pad * 2;
  ctx.textAlign = 'center';
  let small = Math.max(16, Math.min(Math.round(H * 0.11), Math.round(W * 0.07)));
  ctx.font = font(small, 600);
  const lines = fitText(ctx, data.title, tw, H > W * 0.55 ? 2 : 1);
  let y = pad;
  for (const l of lines) {
    ctx.fillText(l, W / 2, y, tw);
    y += Math.round(small * 1.15);
  }
  y += Math.round(pad * 0.4);
  let codeSize = Math.max(16, Math.round(small * 0.95));
  ctx.font = font(codeSize, 600);
  while (codeSize > 12 && ctx.measureText(data.code).width > tw) {
    codeSize = Math.round(codeSize * 0.9);
    ctx.font = font(codeSize, 600);
  }
  const footer = data.footer ? Math.round(small * 0.75) : 0;
  const barsH = H - y - pad - codeSize * 1.2 - (footer ? footer * 1.2 : 0);
  if (bits && barsH > 24) drawBars(ctx, bits, pad, y, tw, Math.round(Math.min(barsH, W * 0.45)));
  else if (!bits) {
    // No barcode possible (letters it cannot carry) — the code large instead.
    small = Math.round(codeSize * 1.6);
    ctx.font = font(small);
    ctx.fillText(data.code, W / 2, y + Math.max(0, barsH / 2 - small / 2), tw);
    ctx.font = font(codeSize, 600);
  }
  y +=
    Math.max(0, Math.round(bits ? Math.min(barsH, W * 0.45) : barsH)) + Math.round(codeSize * 0.15);
  if (bits) ctx.fillText(data.code, W / 2, y, tw);
  y += Math.round(codeSize * 1.1);
  if (footer && data.footer) {
    ctx.font = font(footer, 400);
    ctx.fillText(data.footer, W / 2, y, tw);
  }
}

/** QR on the left (or top on narrow labels), code + name + footer as text. */
function drawQrLabel(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  pad: number,
  data: LabelData,
) {
  const qr = QRCode.create(data.code, { errorCorrectionLevel: 'M' }).modules;
  const landscape = W / H >= 1.35;

  // QR: as large as the layout allows, whole dots per module so it scans crisp.
  const qrBox = landscape
    ? Math.min(H - pad * 2, Math.round(W * 0.45))
    : Math.min(W - pad * 2, Math.round(H * 0.6));
  const mod = Math.max(1, Math.floor(qrBox / qr.size));
  const qrPx = mod * qr.size;
  const qrX = landscape ? pad : Math.round((W - qrPx) / 2);
  const qrY = landscape ? Math.round((H - qrPx) / 2) : pad;
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++)
      if (qr.data[y * qr.size + x]) ctx.fillRect(qrX + x * mod, qrY + y * mod, mod, mod);
  }

  // Text: code (bold), title (up to 2 lines), footer (small).
  const tx = landscape ? qrX + qrPx + pad : pad;
  const tw = W - tx - pad;
  let ty = landscape ? pad : qrY + qrPx + Math.round(pad * 0.6);
  const room = H - ty - pad;
  let codeSize = Math.max(
    18,
    Math.min(Math.round(landscape ? H * 0.16 : room * 0.38), Math.round(W * 0.12)),
  );
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

/* ---- Direct printing over Bluetooth LE (Chrome on Android) ----------------
 * Zebra's "Parser Service": whatever is written to its To-Printer
 * characteristic is printed as ZPL. The phone asks once which printer to use;
 * the connection is kept for the rest of the session. Safari (iPhone) has no
 * Web Bluetooth, there the phone's print dialog is used instead.
 * Source: Zebra AppNote "Bluetooth LE" v4.
 */
const PARSER = '38eb4a80-c570-11e3-9507-0002a5d5c51b';
const TO_PRINTER = '38eb4a82-c570-11e3-9507-0002a5d5c51b';

type BleChar = {
  writeValueWithResponse?: (d: BufferSource) => Promise<void>;
  writeValueWithoutResponse?: (d: BufferSource) => Promise<void>;
  writeValue: (d: BufferSource) => Promise<void>;
};
type BleDevice = {
  name?: string;
  gatt?: {
    connected: boolean;
    connect: () => Promise<{
      getPrimaryService: (
        s: string,
      ) => Promise<{ getCharacteristic: (c: string) => Promise<BleChar> }>;
    }>;
  };
};
let device: BleDevice | null = null;
let channel: BleChar | null = null;

export const canPrintBluetooth = () => typeof navigator !== 'undefined' && 'bluetooth' in navigator;

export const printerName = () => device?.name ?? null;

async function connect(): Promise<BleChar> {
  if (channel && device?.gatt?.connected) return channel;
  if (!device) {
    const bt = (
      navigator as unknown as {
        bluetooth: { requestDevice: (o: unknown) => Promise<BleDevice> };
      }
    ).bluetooth;
    // Only Zebra printers in the list: they advertise as "XX…" (serial) or "ZQ…".
    device = await bt.requestDevice({
      filters: [{ namePrefix: 'XX' }, { namePrefix: 'ZQ' }, { services: [PARSER] }],
      optionalServices: [PARSER],
    });
  }
  const server = await device.gatt!.connect();
  const service = await server.getPrimaryService(PARSER);
  channel = await service.getCharacteristic(TO_PRINTER);
  return channel;
}

/**
 * Sends ZPL to the printer in small pieces (BLE packets are short). Each piece
 * waits for the printer's acknowledgement, so nothing is lost on the way.
 * The printer is first switched to ZPL: a ZQ511 set to its line-print
 * language would otherwise ignore the label.
 */
export async function printZplBluetooth(zpl: string): Promise<void> {
  const ch = await connect();
  const bytes = new TextEncoder().encode(`! U1 setvar "device.languages" "zpl"\r\n${zpl}`);
  const PART = 180;
  for (let i = 0; i < bytes.length; i += PART) {
    const piece = bytes.slice(i, i + PART);
    if (ch.writeValueWithResponse) await ch.writeValueWithResponse(piece);
    else await ch.writeValue(piece);
  }
}

/** A plain test label (text only), to check the printer and its language. */
export function testZpl(): string {
  return '^XA^PW576^FO30,30^A0N,40,40^FDInverse TEST^FS^FO30,90^A0N,28,28^FDZQ511 OK^FS^XZ\n';
}

/** Forget the printer (e.g. to pick another one). */
export function forgetPrinter() {
  device = null;
  channel = null;
}
