'use client';

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import type { Map as LMap, Marker } from 'leaflet';
import { addressOf, currentPosition } from '@/lib/geo';

type Point = { lat: number; lng: number };

const TBILISI: Point = { lat: 41.7151, lng: 44.8271 };

/**
 * A map in a window: it opens on the device's position when the browser gives
 * one (otherwise on Tbilisi). A tap on the map or dragging the pin moves the
 * point; each move looks up the street address. "✓ OK" hands both back.
 */
export default function MapPicker({
  start,
  onPick,
  onClose,
}: {
  start: Point | null;
  onPick: (p: Point, address: string | null) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LMap | null>(null);
  const pin = useRef<Marker | null>(null);
  const [point, setPoint] = useState<Point | null>(start);
  const [address, setAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<string>(start ? '' : 'ვადგენ მდებარეობას…');
  const [query, setQuery] = useState('');
  const lookup = useRef(0);

  async function place(p: Point, zoom?: number) {
    setPoint(p);
    const L = (await import('leaflet')).default;
    if (!map.current) return;
    if (!pin.current) {
      pin.current = L.marker([p.lat, p.lng], {
        draggable: true,
        icon: L.divIcon({
          html: '📍',
          className: 'map-pin',
          iconSize: [32, 32],
          iconAnchor: [16, 30],
        }),
      }).addTo(map.current);
      pin.current.on('dragend', () => {
        const ll = pin.current!.getLatLng();
        place({ lat: ll.lat, lng: ll.lng });
      });
    } else pin.current.setLatLng([p.lat, p.lng]);
    if (zoom) map.current.setView([p.lat, p.lng], zoom);
    const n = ++lookup.current;
    setStatus('ვეძებ მისამართს…');
    const a = await addressOf(p.lat, p.lng);
    if (n !== lookup.current) return;
    setAddress(a);
    setStatus(a ? '' : 'მისამართი ვერ მოიძებნა — ჩაწერე ხელით.');
  }

  useEffect(() => {
    let off = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (off || !box.current || map.current) return;
      const c = start ?? TBILISI;
      map.current = L.map(box.current).setView([c.lat, c.lng], start ? 17 : 12);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(map.current);
      map.current.on('click', (e) => place({ lat: e.latlng.lat, lng: e.latlng.lng }));
      if (start) place(start);
      else {
        const p = await currentPosition(10000);
        if (off) return;
        if (p) place({ lat: p.lat, lng: p.lng }, 17);
        else setStatus('მდებარეობა ვერ დადგინდა — მონიშნე რუკაზე ან მოძებნე ზემოთ.');
      }
    })();
    return () => {
      off = true;
      map.current?.remove();
      map.current = null;
      pin.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setStatus('ვეძებ…');
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ge&accept-language=ka&q=${encodeURIComponent(query)}`,
      );
      const [hit] = (await res.json()) as { lat: string; lon: string }[];
      if (!hit) return setStatus('ვერ მოიძებნა. მონიშნე რუკაზე.');
      place({ lat: Number(hit.lat), lng: Number(hit.lon) }, 17);
    } catch {
      setStatus('ძებნა ვერ მოხერხდა. მონიშნე რუკაზე.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-3">
      <div className="grid w-full max-w-2xl gap-3 rounded-2xl border border-rule-strong bg-paper p-4">
        <form onSubmit={search} className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="მოძებნე: ქუჩა, ნომერი, ქალაქი"
            className="min-w-0 flex-1 rounded-control border border-rule-strong bg-white px-3 py-2 text-black"
          />
          <button type="submit" className="rounded-control border border-rule-strong px-3">
            🔍
          </button>
        </form>
        <div ref={box} className="h-[60vh] w-full overflow-hidden rounded-control" />
        <p className="min-h-5 text-sm">
          {address ? <>📍 {address}</> : <span className="text-ink-soft">{status}</span>}
        </p>
        <p className="text-xs text-ink-faint">
          დააჭირე რუკაზე ან გადაათრიე 📍, რომ ზუსტად მონიშნო.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-control border border-rule-strong py-3"
          >
            გაუქმება
          </button>
          <button
            type="button"
            disabled={!point}
            onClick={() => point && onPick(point, address)}
            className="rounded-control bg-match py-3 font-semibold text-paper disabled:opacity-50"
          >
            ✓ OK
          </button>
        </div>
      </div>
    </div>
  );
}
