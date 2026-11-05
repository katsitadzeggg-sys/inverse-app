/** Distance in metres between two points (haversine). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const mapsLink = (lat: number, lng: number) => `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;

/**
 * The phone's position, or null if the person declines or it takes too long.
 * The browser's own timeout only starts after the permission prompt is
 * answered, and an unanswered prompt on iPhone never returns — so a hard
 * timer of our own always ends the wait.
 */
export function currentPosition(timeoutMs = 8000): Promise<{ lat: number; lng: number; accuracy: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    let done = false;
    const finish = (v: { lat: number; lng: number; accuracy: number } | null) => {
      if (done) return;
      done = true;
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), timeoutMs + 2000);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        clearTimeout(timer);
        finish({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy });
      },
      () => {
        clearTimeout(timer);
        finish(null);
      },
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 120000 },
    );
  });
}

/** fetch() that gives up after `ms` milliseconds. */
async function fetchJson<T>(url: string, ms: number): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Street address of a point, in Georgian; null if nothing answers in time.
 * OpenStreetMap first (street and number), BigDataCloud as a fallback (city
 * and district). Each has 5 seconds.
 */
export async function addressOf(lat: number, lng: number): Promise<string | null> {
  const osm = await fetchJson<{ address?: Record<string, string>; display_name?: string }>(
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=ka&zoom=18&addressdetails=1`,
    5000,
  );
  if (osm) {
    const a = osm.address ?? {};
    const street = [a.road ?? a.pedestrian ?? a.neighbourhood, a.house_number].filter(Boolean).join(' ');
    const city = a.city ?? a.town ?? a.village ?? a.suburb ?? '';
    const text = [city, street].filter(Boolean).join(', ');
    if (text) return text;
    if (osm.display_name) return osm.display_name.split(',').slice(0, 3).join(',');
  }
  const bdc = await fetchJson<{ city?: string; locality?: string; principalSubdivision?: string }>(
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=ka`,
    5000,
  );
  if (bdc) {
    const text = [bdc.city || bdc.principalSubdivision, bdc.locality && bdc.locality !== bdc.city ? bdc.locality : ''].filter(Boolean).join(', ');
    if (text) return text;
  }
  return null;
}
