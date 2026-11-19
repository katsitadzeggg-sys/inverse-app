'use client';

import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import type { Map as LMap, Marker } from 'leaflet';
import { addressOf, currentPosition } from '@/lib/geo';

type Point = { lat: number; lng: number };

const TBILISI: Point = { lat: 41.7151, lng: 44.8271 };

// Address search: suggestions while typing (Tbilisi first), or pasted
// coordinates / a Google Maps link.
type Hit = { lat: string; lon: string; display_name: string };

function coordsIn(q: string): Point | null {
  const m =
    q.match(/(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)/) ?? q.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (!m) return null;
  const p = { lat: Number(m[1]), lng: Number(m[2]) };
  return Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 ? p : null;
}

/** Nominatim: Georgia only, places around Tbilisi ranked first. */
async function find(q: string): Promise<Hit[]> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=ge&accept-language=ka&viewbox=44.6,41.85,45.05,41.6&q=${encodeURIComponent(q)}`,
  );
  return (await res.json()) as Hit[];
}

/**
 * A map in a window: it opens on the device's position when the browser gives
 * one (otherwise on Tbilisi). A tap on the map or dragging the pin moves the
 * point; each move looks up the street address. "✓ OK" hands both back.
 * Without a position (laptops often have none) the address search finds it:
 * suggestions while typing, or pasted coordinates / a Google Maps link.
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

  const [hits, setHits] = useState<Hit[]>([]);
  const typed = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Suggestions after a pause in typing (the free search allows ~1 request a second). */
  function type(v: string) {
    setQuery(v);
    if (timer.current) clearTimeout(timer.current);
    const q = v.trim();
    if (q.length < 3 || coordsIn(q)) return setHits([]);
    const n = ++typed.current;
    timer.current = setTimeout(async () => {
      try {
        const r = await find(q);
        if (n === typed.current) setHits(r);
      } catch {}
    }, 700);
  }

  function choose(h: Hit) {
    setHits([]);
    setQuery(h.display_name.split(',').slice(0, 3).join(','));
    place({ lat: Number(h.lat), lng: Number(h.lon) }, 17);
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    const c = coordsIn(q);
    if (c) return place(c, 17);
    if (hits[0]) return choose(hits[0]);
    setStatus('ვეძებ…');
    try {
      const [hit] = await find(q);
      if (!hit) return setStatus('ვერ მოიძებნა — სცადე „ქუჩა ნომერი, თბილისი“, ან მონიშნე რუკაზე.');
      choose(hit);
    } catch {
      setStatus('ძებნა ვერ მოხერხდა. მონიშნე რუკაზე.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-3">
      <div className="grid w-full max-w-2xl gap-3 rounded-2xl border border-rule-strong bg-paper p-4">
        <form onSubmit={search} className="relative flex gap-2">
          <input
            value={query}
            onChange={(e) => type(e.target.value)}
            placeholder="მისამართი (ქუჩა ნომერი, ქალაქი) ან კოორდინატები"
            autoFocus
            className="min-w-0 flex-1 rounded-control border border-rule-strong bg-white px-3 py-2 text-black"
          />
          <button type="submit" className="rounded-control border border-rule-strong px-3">
            🔍
          </button>
          {hits.length > 0 && (
            <ul className="absolute top-full right-12 left-0 z-[1100] mt-1 grid max-h-64 overflow-auto rounded-control border border-rule-strong bg-white text-sm text-black shadow-lg">
              {hits.map((h) => (
                <li key={`${h.lat},${h.lon}`}>
                  <button
                    type="button"
                    onClick={() => choose(h)}
                    className="w-full px-3 py-2 text-left hover:bg-black/5"
                  >
                    {h.display_name}
                  </button>
                </li>
              ))}
            </ul>
          )}
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
