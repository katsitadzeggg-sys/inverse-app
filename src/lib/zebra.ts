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
/** How one text line looks: bold or not, and its size against the default (1). */
export type LineLook = { bold?: boolean; scale?: number };
/** Per-company text style of a label: the name line and the company line. */
export type LabelLook = { title?: LineLook; footer?: LineLook };
/** Default: name regular, company bold and a little larger. */
export const DEFAULT_LOOK: Required<{ [K in keyof LabelLook]: Required<LineLook> }> = {
  title: { bold: false, scale: 1 },
  footer: { bold: true, scale: 1.1 },
};
const weightOf = (l: LineLook | undefined, fallback: Required<LineLook>) =>
  (l?.bold ?? fallback.bold) ? 700 : 500;
const scaleOf = (l: LineLook | undefined, fallback: Required<LineLook>) =>
  Math.min(1.6, Math.max(0.6, l?.scale ?? fallback.scale));

export type LabelData = {
  code: string;
  title: string;
  footer?: string;
  mode?: LabelMode;
  /** A small line over the code (optional). */
  sub?: string;
  /** What the QR holds when not the code itself (e.g. a link to the asset's photos). */
  qr?: string;
  /** How many of this label to print (times the panel's copies); default 1. */
  copies?: number;
  /** A quantity from the data (book balance), for "one label per unit". */
  qty?: number | null;
  /** Text style of the name and company lines (set per company in the studio). */
  look?: LabelLook;
};

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

/**
 * Product label: bars on top, the digits under them, the name under the
 * digits (up to two lines) — all centred, the two text sizes in proportion.
 */
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
  // Digits and name share one size scale: digits a little larger and bold.
  let codeSize = Math.max(16, Math.min(Math.round(H * 0.12), Math.round(W * 0.075)));
  ctx.font = font(codeSize, 700);
  while (codeSize > 12 && ctx.measureText(data.code).width > tw) {
    codeSize = Math.round(codeSize * 0.92);
    ctx.font = font(codeSize, 700);
  }
  const nameW = weightOf(data.look?.title, { bold: true, scale: 1 });
  const nameSize = Math.max(
    14,
    Math.round(codeSize * 0.9 * scaleOf(data.look?.title, { bold: true, scale: 1 })),
  );
  ctx.font = font(nameSize, nameW);
  const lines = fitText(ctx, data.title, tw, H > W * 0.55 ? 2 : 1);
  const gap = Math.round(pad * 0.5);
  const textH =
    Math.round(codeSize * 1.15) +
    (lines.length ? gap + lines.length * Math.round(nameSize * 1.15) : 0);
  let y = pad;
  const barsH = Math.round(Math.min(H - pad * 2 - textH - gap, W * 0.45));
  if (bits && barsH > 24) {
    // Bars and text as one block, centred top to bottom.
    y = Math.max(pad, Math.round((H - (barsH + gap + textH)) / 2));
    drawBars(ctx, bits, pad, y, tw, barsH);
    y += barsH + gap;
    ctx.font = font(codeSize, 700);
    ctx.fillText(data.code, W / 2, y, tw);
  } else {
    // No barcode possible (letters it cannot carry) — the code large instead.
    const big = Math.round(codeSize * 1.6);
    ctx.font = font(big);
    y = Math.max(pad, Math.round((H - (big * 1.15 + gap + textH - codeSize * 1.15)) / 2));
    ctx.fillText(data.code, W / 2, y, tw);
    y += Math.round(big * 0.05);
    codeSize = big;
  }
  y += Math.round(codeSize * 1.15);
  if (lines.length) {
    y += gap;
    ctx.font = font(nameSize, nameW);
    for (const l of lines) {
      ctx.fillText(l, W / 2, y, tw);
      y += Math.round(nameSize * 1.15);
    }
  }
}

/**
 * QR on the left (top on narrow labels); beside it the code, the name and the
 * footer (e.g. AA01 / მელიქიშვილი / სს ექსტრა) as one block centred both
 * ways, each line as large as fits, the code largest. The QR holds only the
 * code unless the label says otherwise.
 */
function drawQrLabel(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  pad: number,
  data: LabelData,
) {
  const qr = QRCode.create(data.qr ?? data.code, { errorCorrectionLevel: 'M' }).modules;
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

  // The text area beside (or under) the QR.
  const tx = landscape ? qrX + qrPx + pad : pad;
  const tw = W - tx - pad;
  const top = landscape ? pad : qrY + qrPx + Math.round(pad * 0.6);
  const room = H - top - pad;
  const cx = tx + tw / 2;
  ctx.textAlign = 'center';

  // Line sizes: code largest; name and footer one size, a step smaller.
  const fit = (text: string, size: number, weight: number, min: number) => {
    ctx.font = font(size, weight);
    while (size > min && ctx.measureText(text).width > tw) {
      size = Math.round(size * 0.92);
      ctx.font = font(size, weight);
    }
    return size;
  };
  const tLook = {
    w: weightOf(data.look?.title, DEFAULT_LOOK.title),
    k: scaleOf(data.look?.title, DEFAULT_LOOK.title),
  };
  const fLook = {
    w: weightOf(data.look?.footer, DEFAULT_LOOK.footer),
    k: scaleOf(data.look?.footer, DEFAULT_LOOK.footer),
  };
  const rest: [string, number, number][] = [];
  if (data.sub) rest.push([data.sub, 1, 500]);
  if (data.title) rest.push([data.title, tLook.k, tLook.w]);
  if (data.footer) rest.push([data.footer, fLook.k, fLook.w]);
  const share = rest.reduce((s2, [, k]) => s2 + 0.75 * k, 0);
  let codeSize = Math.min(Math.round(room / (1.2 + share)), Math.round(W * 0.14));
  codeSize = fit(data.code, Math.max(18, codeSize), 700, 14);
  // One base size for the smaller lines, each scaled by its own setting and
  // shrunk only as much as its own text needs to fit the width.
  const base = Math.max(14, Math.round(codeSize * 0.6));
  const sized = rest.map(([t, k, w]) => [t, fit(t, Math.round(base * k), w, 11), w] as const);
  const lines: [string, number, number][] = [];
  const subLine = data.sub ? sized.shift() : undefined;
  if (subLine) lines.push([...subLine]);
  lines.push([data.code, codeSize, 700]);
  for (const l of sized) lines.push([...l]);
  const lh = (sz: number) => Math.round(sz * 1.25);
  const block = lines.reduce((s2, [, sz]) => s2 + lh(sz), 0);
  let ty = top + Math.max(0, Math.round((room - block) / 2));
  for (const [t, sz, wt] of lines) {
    if (ty + sz > H - pad / 2) break;
    ctx.font = font(sz, wt);
    ctx.fillText(t, cx, ty + Math.round((lh(sz) - sz) / 2), tw);
    ty += lh(sz);
  }
}

/** One label as ZPL: the canvas turned into a 1-bit graphic field. */
export function canvasToZpl(canvas: HTMLCanvasElement, copies = 1): string {
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
  return `^XA^PW${W}^LL${H}^LH0,0^FO0,0^GFA,${total},${total},${rowBytes},${hex}^FS^PQ${Math.max(1, Math.round(copies))}^XZ\n`;
}

/** Each label drawn once; the printer repeats it (^PQ) for its copies. */
export function labelsToZpl(size: LabelSize, items: LabelData[], copies = 1): string {
  return items
    .filter((d) => (d.copies ?? 1) * copies > 0)
    .map((d) => canvasToZpl(drawLabel(size, d), (d.copies ?? 1) * copies))
    .join('');
}

/** Total labels a list prints with the panel's copies. */
export function labelCount(items: LabelData[], copies = 1): number {
  return items.reduce((s, d) => s + Math.max(0, d.copies ?? 1) * copies, 0);
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
