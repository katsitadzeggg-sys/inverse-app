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
      locateFile: (path: string, prefix: string) =>
        path.endsWith('.wasm') ? '/zxing/zxing_reader.wasm' : prefix + path,
    });
    return new mod.BarcodeDetector({
      formats: [
        'ean_13',
        'ean_8',
        'upc_a',
        'upc_e',
        'code_128',
        'code_39',
        'qr_code',
        'data_matrix',
        'itf',
      ],
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
  variant = 'default',
  fullscreen = false,
  closeOnCode = false,
  closeKey = 0,
  shape = 'wide',
}: {
  onCode: (code: string) => void;
  label?: string;
  /** Shown on the camera picture itself, at the bottom (e.g. the product just read). */
  overlay?: ReactNode;
  onOpenChange?: (open: boolean) => void;
  /** 'big': large green button with a barcode picture (fixed-asset screen). */
  variant?: 'default' | 'big';
  /** Stock app: iPhone code-scanner look — corner marks, a torch and ✕; what was read shows under the picture. */
  fullscreen?: boolean;
  /** Close the camera as soon as a code is read (shelf QR). */
  closeOnCode?: boolean;
  /** Changing this number closes the camera (e.g. the product was not found and its form must show). */
  closeKey?: number;
  /** Aiming marks: 'square' for a shelf QR, 'wide' for a product barcode. */
  shape?: 'square' | 'wide';
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
  // Torch, where the phone lets a web page switch it (not on every iPhone).
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const [torchable, setTorchable] = useState(false);
  const [torch, setTorch] = useState(false);
  useEffect(() => {
    if (!closeKey) return;
    const t = setTimeout(() => setOn(false), 0);
    return () => clearTimeout(t);
  }, [closeKey]);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const last = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const closeOnRef = useRef(closeOnCode);
  useEffect(() => {
    closeOnRef.current = closeOnCode;
  }, [closeOnCode]);
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
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
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
      trackRef.current = track ?? null;
      const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
      setTorchable(!!caps.torch);
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
            // A code that stays in view is read once; it counts again only after
            // it has been out of view for a moment (or another code came between).
            if (code && code === last.current.code && now - last.current.at <= 1200) {
              last.current.at = now;
            } else if (code) {
              last.current = { code, at: now };
              navigator.vibrate?.(60);
              // The result is shown on the picture (overlay), not as a text line.
              setStatus(null);
              onCodeRef.current(code);
              if (closeOnRef.current) setOn(false);
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
      trackRef.current = null;
      setTorch(false);
    };
  }, [on]);

  function toggleTorch() {
    const next = !torch;
    trackRef.current
      ?.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      .then(() => setTorch(next))
      .catch(() => setTorchable(false));
  }

  return (
    <div className="grid gap-2">
      {!(on && fullscreen) && (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setStatus(null);
            setOn((v) => !v);
          }}
          className={
            variant === 'big'
              ? `flex items-center justify-center gap-3 rounded-control px-4 py-5 text-xl font-semibold ${on ? 'border border-rule-strong bg-paper-sunk' : 'bg-match text-white'}`
              : 'rounded-control border border-rule-strong bg-paper-sunk px-4 py-3 text-base font-semibold'
          }
        >
          {variant === 'big' && !on && (
            // A barcode picture, so the button is recognised at a glance.
            <svg viewBox="0 0 48 32" className="h-8 w-12" aria-hidden="true" fill="currentColor">
              {[0, 4, 7, 12, 15, 18, 23, 27, 30, 35, 38, 42, 45].map((x, i) => (
                <rect
                  key={x}
                  x={x}
                  y="0"
                  width={i % 3 === 0 ? 3 : i % 3 === 1 ? 1.5 : 2.2}
                  height="32"
                />
              ))}
            </svg>
          )}
          {on ? 'კამერის დახურვა' : variant === 'big' ? label : `📷 ${label}`}
        </button>
      )}
      {on && fullscreen && (
        // iPhone code-scanner look, inside the page: corner marks, ✕, torch.
        <div className="grid gap-2">
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-black">
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              className="absolute inset-0 h-full w-full object-cover"
            />
            {shape === 'square' ? (
              <svg
                viewBox="0 0 100 100"
                className="pointer-events-none absolute left-1/2 top-1/2 h-[72%] -translate-x-1/2 -translate-y-1/2"
                fill="none"
                stroke="white"
                strokeWidth="3.2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M4 22 V12 A8 8 0 0 1 12 4 H22" />
                <path d="M78 4 H88 A8 8 0 0 1 96 12 V22" />
                <path d="M96 78 V88 A8 8 0 0 1 88 96 H78" />
                <path d="M22 96 H12 A8 8 0 0 1 4 88 V78" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 200 100"
                className="pointer-events-none absolute left-1/2 top-1/2 w-[86%] -translate-x-1/2 -translate-y-1/2"
                fill="none"
                stroke="white"
                strokeWidth="3.2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M4 26 V12 A8 8 0 0 1 12 4 H30" />
                <path d="M170 4 H188 A8 8 0 0 1 196 12 V26" />
                <path d="M196 74 V88 A8 8 0 0 1 188 96 H170" />
                <path d="M30 96 H12 A8 8 0 0 1 4 88 V74" />
              </svg>
            )}
            <button
              type="button"
              onClick={() => setOn(false)}
              aria-label="დახურვა"
              className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full bg-black/55 text-xl text-white"
            >
              ✕
            </button>
            {torchable && (
              <button
                type="button"
                onClick={toggleTorch}
                aria-label="ფანარი"
                className={`absolute bottom-2 left-1/2 flex h-11 w-11 -translate-x-1/2 items-center justify-center rounded-full text-xl ${torch ? 'bg-white text-black' : 'bg-black/60 text-white'}`}
              >
                🔦
              </button>
            )}
            {status && (
              <p className="pointer-events-none absolute inset-x-0 top-2 px-14 text-center text-xs text-white/85">
                {status}
              </p>
            )}
          </div>
          {overlay && <div className="rounded-2xl bg-black/80 p-3 text-white">{overlay}</div>}
        </div>
      )}
      {on && !fullscreen && (
        <div className="relative overflow-hidden rounded-control bg-black">
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            className="aspect-[4/3] w-full object-cover"
          />
          {/* Guide: the band the reader looks at. */}
          <div className="pointer-events-none absolute inset-x-[5%] top-1/2 h-[45%] -translate-y-1/2 scan-frame rounded-md border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          {status && (
            <p className="pointer-events-none absolute inset-x-0 top-0 bg-black/40 px-3 py-1.5 text-center text-xs text-white">
              {status}
            </p>
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
