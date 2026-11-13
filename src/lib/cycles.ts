import type { CyclePeriod } from '@/types/database';

export const PERIODS: { value: CyclePeriod; label: string }[] = [
  { value: 'month', label: 'ყოველთვიური' },
  { value: 'quarter', label: 'კვარტალური' },
  { value: 'half', label: 'ნახევარწლიური' },
  { value: 'year', label: 'წლიური' },
];

const MONTHS = [
  'იანვარი',
  'თებერვალი',
  'მარტი',
  'აპრილი',
  'მაისი',
  'ივნისი',
  'ივლისი',
  'აგვისტო',
  'სექტემბერი',
  'ოქტომბერი',
  'ნოემბერი',
  'დეკემბერი',
];

/**
 * A count cycle's name from the day it started, by how often the company
 * counts: "2026 ნოემბერი", "2026 Q4", "2026 H2" or "2026".
 */
export function cycleLabel(startedAt: string, period: CyclePeriod = 'quarter'): string {
  const [y, m] = new Date(startedAt)
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Tbilisi' })
    .split('-')
    .map(Number);
  const month = (m ?? 1) - 1;
  if (period === 'month') return `${y} ${MONTHS[month]}`;
  if (period === 'half') return `${y} H${month < 6 ? 1 : 2}`;
  if (period === 'year') return `${y}`;
  return `${y} Q${Math.floor(month / 3) + 1}`;
}
