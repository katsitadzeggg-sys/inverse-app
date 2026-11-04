'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

type Detector = { detect: (s: ImageBitmapSource) => Promise<{ rawValue: string }[]> };

/**
 * Picks the reader once per page: the browser's own BarcodeDetector where it
 * exists (Chrome on Android), otherwise the ZXing WebAssembly ponyfill
 * (Safari on iPhone has no BarcodeDetector). The .wasm file is served from
 * this app (public/zxing), not a CDN, so it loads wherever the app loads.
 */
let detectorPromise: Promise<Detector> | null = null;
function getDetector(): Promise<Detector> {
  detectorPromise ??= (async () => {
    const Native = (globalThis as { BarcodeDetector?: new () => Detector }).BarcodeDetector;
    if (Native) return new Native();
    const mod = await import('barcode-detector/ponyfill');
    mod.setZXingModuleOverrides({
      locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? '/zxing/zxing_reader.wasm' : prefix + path),
    });
    return new mod.BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code', 'data_matrix', 'itf'],
    }) as unknown as Detector;
  })();
  detectorPromise.catch(() => (detectorPromise = null));
  return detectorPromise;
}

/**
 * Camera barcode/QR reader. Reads the middle band of the picture (where the
 * guide box is) at full camera resolution, which is what small codes such as
 * EAN-8 on a cigarette pack need. Calls onCode once per new code; the same
 * code is ignored for 2 s so one item is not counted twice.
 */
export default function Scanner({
  onCode,
  label = 'კამერა',
  overlay,
  onOpenChange,
}: {
  onCode: (code: string) => void;
  label?: string;
  /** Shown on the camera picture itself, at the bottom (e.g. the product just read). */
  overlay?: ReactNode;
  onOpenChange?: (open: boolean) => void;
}) {
  const [on, setOn] = useState(false);
  const onOpenRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenRef.current = onOpenChange;
  }, [onOpenChange]);
  useEffect(() => {
    onOpenRef.current?.(on);
  }, [on]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const last = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    if (!on) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
      } catch (e) {
        const name = (e as { name?: string })?.name;
        setError(
          name === 'NotAllowedError'
            ? 'კამერაზე წვდომა არ არის დაშვებული. Safari: aA → ვებგვერდის პარამეტრები → კამერა → დაშვება.'
            : 'კამერა ვერ გაიხსნა. გახსენი გვერდი პირდაპირ Safari-ში ან Chrome-ში, ან ჩაწერე კოდი ხელით.',
        );
        setOn(false);
        return;
      }
      const video = videoRef.current;
      if (!video || stopped) return;
      video.srcObject = stream;
      await video.play().catch(() => {});
      const track = stream.getVideoTracks()[0];
      // Continuous focus where the phone supports it; ignored elsewhere.
      track
        ?.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] })
        .catch(() => {});

      setStatus('ვამზადებ წამკითხველს…');
      let detector: Detector;
      try {
        detector = await getDetector();
      } catch {
        setError('ბარკოდის წამკითხველი ვერ ჩაიტვირთა. შეამოწმე ინტერნეტი ან ჩაწერე კოდი ხელით.');
        setOn(false);
        return;
      }
      setStatus('მიიტანე ბარკოდი ჩარჩოში, 10–20 სმ-ზე');

      const tick = async () => {
        if (stopped) return;
        try {
          const w = video.videoWidth;
          const h = video.videoHeight;
          if (w && h && ctx) {
            // Middle band: 90% of the width, 45% of the height.
            const cw = Math.round(w * 0.9);
            const ch = Math.round(h * 0.45);
            canvas.width = cw;
            canvas.height = ch;
            ctx.drawImage(video, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, cw, ch);
            const codes = await detector.detect(ctx.getImageData(0, 0, cw, ch));
            const code = codes[0]?.rawValue?.trim();
            const now = Date.now();
            if (code && (code !== last.current.code || now - last.current.at > 2000)) {
              last.current = { code, at: now };
              navigator.vibrate?.(60);
              // The result is shown on the picture (overlay), not as a text line.
              setStatus(null);
              onCodeRef.current(code);
            }
          }
        } catch {
          // A frame that cannot be read is skipped.
        }
        timer = window.setTimeout(tick, 200);
      };
      tick();
    })();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [on]);

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setStatus(null);
          setOn((v) => !v);
        }}
        className="rounded-control border border-rule-strong bg-paper-sunk px-4 py-3 text-base font-semibold"
      >
        {on ? 'კამერის დახურვა' : `📷 ${label}`}
      </button>
      {on && (
        <div className="relative overflow-hidden rounded-control bg-black">
          <video ref={videoRef} muted playsInline autoPlay className="aspect-[4/3] w-full object-cover" />
          {/* Guide: the band the reader looks at. */}
          <div className="pointer-events-none absolute inset-x-[5%] top-1/2 h-[45%] -translate-y-1/2 rounded-md border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          {status && (
            <p className="pointer-events-none absolute inset-x-0 top-0 bg-black/40 px-3 py-1.5 text-center text-xs text-white">{status}</p>
          )}
          {overlay && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-3 pb-2 pt-6 text-white">
              {overlay}
            </div>
          )}
        </div>
      )}
      {error && <p className="text-sm text-mismatch">{error}</p>}
    </div>
  );
}
