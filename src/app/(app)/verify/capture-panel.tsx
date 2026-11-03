'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Location } from '@/types/database';
import { Alert, Button, Card, Field, inputClass } from '@/components/ui';

type Mode = 'idle' | 'streaming' | 'captured' | 'uploading';

const MAX_BYTES = 10 * 1024 * 1024;

export default function CapturePanel({ locations }: { locations: Location[] }) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const [mode, setMode] = useState<Mode>('idle');
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const setPreviewFile = useCallback((next: File) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const url = URL.createObjectURL(next);
    previewUrlRef.current = url;
    setFile(next);
    setPreview(url);
    setMode('captured');
  }, []);

  // Release the camera and the object URL when the panel goes away.
  useEffect(() => {
    return () => {
      stopCamera();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, [stopCamera]);

  async function startCamera() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // Rear camera on a phone; the same request works for a head-worn camera.
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setMode('streaming');
    } catch (cause) {
      setError(
        cause instanceof Error && cause.name === 'NotAllowedError'
          ? 'Camera access was blocked. Allow it in your browser, or upload a photo instead.'
          : 'No camera available. Upload a photo instead.',
      );
    }
  }

  function capture() {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError('Could not read a frame from the camera.');
          return;
        }
        stopCamera();
        setPreviewFile(new File([blob], 'capture.jpg', { type: 'image/jpeg' }));
      },
      'image/jpeg',
      0.9,
    );
  }

  function reset() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setFile(null);
    setPreview(null);
    setError(null);
    setMode('idle');
  }

  async function submit() {
    if (!file || !locationId) return;
    setMode('uploading');
    setError(null);

    const body = new FormData();
    body.append('image', file);
    body.append('location_id', locationId);

    try {
      const response = await fetch('/api/verify', { method: 'POST', body });
      const payload = (await response.json()) as { id?: string; error?: string };

      if (!response.ok || !payload.id) {
        setError(payload.error ?? 'Verification failed.');
        setMode('captured');
        return;
      }
      router.push(`/checks/${payload.id}`);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setMode('captured');
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card title="Camera">
        <div className="relative aspect-video overflow-hidden rounded-control border border-rule bg-paper">
          {preview ? (
            // The captured frame, not a live feed — analysis runs on exactly this image.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Captured shelf" className="h-full w-full object-contain" />
          ) : (
            <video
              ref={videoRef}
              playsInline
              muted
              className={`h-full w-full object-cover ${mode === 'streaming' ? '' : 'hidden'}`}
            />
          )}

          {mode === 'idle' && !preview && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
              <p className="text-sm text-ink-faint">Camera is off</p>
              <Button type="button" onClick={startCamera} variant="secondary">
                Start camera
              </Button>
            </div>
          )}

          {mode === 'uploading' && (
            <div className="absolute inset-0 flex items-center justify-center bg-paper/80">
              <p className="text-sm text-ink">Analyzing the shelf…</p>
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          {mode === 'streaming' && (
            <>
              <Button type="button" onClick={capture}>
                Capture frame
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  stopCamera();
                  setMode('idle');
                }}
              >
                Stop camera
              </Button>
            </>
          )}

          {mode === 'captured' && (
            <>
              <Button type="button" onClick={submit} disabled={!locationId}>
                Analyze this photo
              </Button>
              <Button type="button" variant="ghost" onClick={reset}>
                Retake
              </Button>
            </>
          )}

          {(mode === 'idle' || mode === 'streaming') && (
            <label className="inline-flex cursor-pointer items-center rounded-control border border-rule-strong bg-paper-sunk px-4 py-2 text-sm font-medium transition hover:border-ink-faint">
              Upload a photo
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(event) => {
                  const selected = event.target.files?.[0];
                  if (!selected) return;
                  if (selected.size > MAX_BYTES) {
                    setError('That photo is larger than 10 MB.');
                    return;
                  }
                  stopCamera();
                  setPreviewFile(selected);
                }}
              />
            </label>
          )}
        </div>

        {error && (
          <div className="mt-4">
            <Alert>{error}</Alert>
          </div>
        )}
      </Card>

      <div className="space-y-6">
        <Card title="Location">
          <Field label="Verify against" hint="Only locations with stock on record are listed.">
            <select
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
              className={inputClass}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code} — {location.name}
                </option>
              ))}
            </select>
          </Field>
        </Card>

        <Card title="Getting a good count">
          <ul className="space-y-2 text-sm text-ink-faint">
            <li>Fill the frame with one shelf — not the whole rack.</li>
            <li>Shoot straight on. Oblique angles hide the back of each row.</li>
            <li>Avoid glare on packaging; it costs the model confidence.</li>
            <li>
              Look-alike variants get flagged for a barcode scan rather than guessed at.
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
