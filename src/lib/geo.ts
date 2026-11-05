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

/** Street address of a point (OpenStreetMap), in Georgian; null if it fails. */
export async function addressOf(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=ka&zoom=18&addressdetails=1`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const j = (await res.json()) as { address?: Record<string, string>; display_name?: string };
    const a = j.address ?? {};
    const street = [a.road ?? a.pedestrian ?? a.neighbourhood, a.house_number].filter(Boolean).join(' ');
    const city = a.city ?? a.town ?? a.village ?? a.suburb ?? '';
    const text = [city, street].filter(Boolean).join(', ');
    return text || j.display_name?.split(',').slice(0, 3).join(',') || null;
  } catch {
    return null;
  }
}
