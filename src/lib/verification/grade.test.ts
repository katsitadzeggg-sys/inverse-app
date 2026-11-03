import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grade, tally } from './grade.ts';
import type { ShelfObservation } from './schema.ts';

function observation(overrides: Partial<ShelfObservation> = {}): ShelfObservation {
  return {
    sku: 'JAN-1362',
    detected_quantity: 12,
    confidence: 0.95,
    identifiable: true,
    notes: '',
    ...overrides,
  };
}

test('a confident count equal to the record is a match', () => {
  assert.equal(grade(observation(), 12).status, 'match');
});

test('a confident count different from the record is a mismatch', () => {
  const result = grade(observation({ detected_quantity: 9 }), 12);
  assert.equal(result.status, 'mismatch');
  assert.equal(result.detected, 9);
  assert.equal(result.expected, 12);
});

test('low confidence never produces a mismatch, even when the numbers differ', () => {
  assert.equal(
    grade(observation({ detected_quantity: 9, confidence: 0.3 }), 12).status,
    'partial',
  );
});

test('look-alike variants are flagged for a barcode instead of graded', () => {
  const result = grade(observation({ identifiable: false }), 12);
  assert.equal(result.status, 'partial');
  assert.equal(result.needsBarcode, true);
});

test('a look-alike stays flagged even when the count happens to agree', () => {
  const result = grade(observation({ identifiable: false, confidence: 0.99 }), 12);
  assert.equal(result.status, 'partial');
});

test('an item absent from the record is unknown, not a mismatch', () => {
  const result = grade(observation({ sku: 'UNKNOWN' }), null);
  assert.equal(result.status, 'unknown');
  assert.equal(result.expected, null);
});

test('a product seen zero times against a non-zero record is a mismatch', () => {
  assert.equal(grade(observation({ detected_quantity: 0 }), 4).status, 'mismatch');
});

test('tally counts each verdict', () => {
  const items = [
    grade(observation(), 12),
    grade(observation({ detected_quantity: 9 }), 12),
    grade(observation({ identifiable: false }), 12),
    grade(observation({ sku: 'UNKNOWN' }), null),
  ];
  const result = tally(items);
  assert.deepEqual(result, {
    total: 4,
    match: 1,
    partial: 1,
    mismatch: 1,
    unknown: 1,
    needsBarcode: 1,
  });
});
