/** A count cycle's name from the day it started: "2026 Q4". */
export function cycleLabel(startedAt: string): string {
  const d = new Date(startedAt);
  const [y, m] = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Tbilisi' }).split('-').map(Number);
  return `${y} Q${Math.floor(((m ?? 1) - 1) / 3) + 1}`;
}
