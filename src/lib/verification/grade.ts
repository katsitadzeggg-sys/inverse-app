import type { MatchStatus } from '@/types/database';
import type { ShelfObservation } from './schema';

/** Below this the model's own count is not trusted enough to call a mismatch. */
const CONFIDENCE_FLOOR = 0.6;

export type GradedObservation = {
  sku: string;
  expected: number | null;
  detected: number;
  confidence: number;
  status: MatchStatus;
  needsBarcode: boolean;
  notes: string;
};

/**
 * Turns one model observation into a green/yellow/red verdict.
 *
 * The model never decides this. It reports what it saw and how sure it was;
 * the comparison against the record — and the decision to escalate to a human
 * or a barcode scan — is made here, where it can be reasoned about and changed
 * without re-prompting.
 */
export function grade(
  observation: ShelfObservation,
  expected: number | null,
): GradedObservation {
  const base = {
    sku: observation.sku,
    expected,
    detected: observation.detected_quantity,
    confidence: observation.confidence,
    needsBarcode: !observation.identifiable,
    notes: observation.notes,
  };

  // Not in the record at all — a human decides what it is.
  if (expected === null) {
    return { ...base, status: 'unknown' };
  }

  // Visually identical variants: vision alone cannot settle this, whatever the count.
  if (!observation.identifiable) {
    return { ...base, status: 'partial' };
  }

  // Too unsure to accuse the record of being wrong.
  if (observation.confidence < CONFIDENCE_FLOOR) {
    return { ...base, status: 'partial' };
  }

  return {
    ...base,
    status: observation.detected_quantity === expected ? 'match' : 'mismatch',
  };
}

export function tally(items: GradedObservation[]) {
  return {
    total: items.length,
    match: items.filter((i) => i.status === 'match').length,
    partial: items.filter((i) => i.status === 'partial').length,
    mismatch: items.filter((i) => i.status === 'mismatch').length,
    unknown: items.filter((i) => i.status === 'unknown').length,
    needsBarcode: items.filter((i) => i.needsBarcode).length,
  };
}
