'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Camera barcode/QR reader. Uses the browser's own BarcodeDetector where it
 * exists (Chrome on Android) and the WebAssembly ponyfill elsewhere (Safari on
 * iPhone). Calls onCode once per new code; the same code is ignored for 2 s so
 * one box is not counted twice by holding the phone still.
 */
export default function Scanner({ onCode, label = 'კამერა' }: { onCode: (code: string) => void; label?: string }) {
  const [on, setOn] = useState(false);
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
    let raf = 0;
    let stopped = false;

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
        const video = videoRef.current;
        if (!video || stopped) return;
        video.srcObject = stream;
        await video.play();

        type Detector = { detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]> };
        const Native = (globalThis as { BarcodeDetector?: new () => Detector }).BarcodeDetector;
        let detector: Detector;
        try {
          detector = Native ? new Native() : new (await import('barcode-detector/ponyfill')).BarcodeDetector();
        } catch {
          setError('ბარკოდის წამკითხველი ვერ ჩაიტვირთა. შეამოწმე ინტერნეტი ან ჩაწერე კოდი ხელით.');
          setOn(false);
          return;
        }

        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(video);
            const code = codes[0]?.rawValue?.trim();
            const now = Date.now();
            if (code && (code !== last.current.code || now - last.current.at > 2000)) {
              last.current = { code, at: now };
              navigator.vibrate?.(60);
              onCodeRef.current(code);
            }
          } catch {
            // A frame that cannot be read is skipped.
          }
          raf = window.setTimeout(tick, 250);
        };
        tick();
      } catch (e) {
        const name = (e as { name?: string })?.name;
        setError(
          name === 'NotAllowedError'
            ? 'კამერაზე წვდომა არ არის დაშვებული. გახსენი გვერდი Safari-ში ან Chrome-ში და დაუშვი კამერა (aA → ვებგვერდის პარამეტრები → კამერა).'
            : 'კამერა ვერ გაიხსნა. გახსენი გვერდი პირდაპირ Safari-ში ან Chrome-ში, ან ჩაწერე კოდი ხელით.',
        );
        setOn(false);
      }
    })();

    return () => {
      stopped = true;
      window.clearTimeout(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [on]);

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOn((v) => !v);
        }}
        className="rounded-control border border-rule-strong bg-paper-sunk px-4 py-3 text-base font-semibold"
      >
        {on ? 'კამერის დახურვა' : `📷 ${label}`}
      </button>
      {on && (
        <video
          ref={videoRef}
          muted
          playsInline
          className="aspect-[4/3] w-full rounded-control bg-black object-cover"
        />
      )}
      {error && <p className="text-sm text-mismatch">{error}</p>}
    </div>
  );
}
