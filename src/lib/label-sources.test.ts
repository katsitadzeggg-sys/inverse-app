import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assetsFromRows,
  notBarcodable,
  parseRanges,
  productsFromRows,
  productsFromText,
  shelvesFromRows,
} from './label-sources.ts';

test('several shelf ranges in one field', () => {
  const r = parseRanges('AA1-AA25, AB1-AB23');
  assert.equal(r.codes.length, 48);
  assert.equal(r.codes[0], 'AA1');
  assert.equal(r.codes[24], 'AA25');
  assert.equal(r.codes[25], 'AB1');
  assert.equal(r.codes[47], 'AB23');
  assert.deepEqual(r.errors, []);
});

test('ranges keep zero padding, accept short form, singles and lower case', () => {
  assert.deepEqual(parseRanges('a-01-a-03').codes, ['A-01', 'A-02', 'A-03']);
  assert.deepEqual(parseRanges('B1-3; C7').codes, ['B1', 'B2', 'B3', 'C7']);
  assert.deepEqual(parseRanges('D8..D10').codes, ['D8', 'D9', 'D10']);
});

test('a backwards range is reported, duplicates printed once', () => {
  const r = parseRanges('A5-A1, B1, B1');
  assert.equal(r.errors.length, 1);
  assert.deepEqual(r.codes, ['B1']);
});

test('shelves from Excel with or without a header', () => {
  const withHeader = shelvesFromRows([
    ['თაროს კოდი', 'დასახელება'],
    ['aa1', 'ზეთები'],
    ['AA2', ''],
  ]);
  assert.deepEqual(
    withHeader.map((s) => [s.code, s.title]),
    [
      ['AA1', 'ზეთები'],
      ['AA2', ''],
    ],
  );
  assert.equal(shelvesFromRows([['B1', 'სასმელი']])[0].title, 'სასმელი');
});

test('products: barcode is the bars, name and quantity read', () => {
  const p = productsFromRows([
    ['შტრიხკოდი', 'არტიკული', 'დასახელება', 'რაოდენობა'],
    ['4860103711939', '10234', 'ზეთი 1ლ', '12'],
    ['', '20555', 'შაქარი', '2,5'],
  ]);
  assert.equal(p[0].code, '4860103711939');
  assert.equal(p[0].title, 'ზეთი 1ლ');
  assert.equal(p[0].qty, 12);
  assert.equal(p[1].code, '20555'); // no barcode: the code becomes the bars
  assert.equal(p[1].qty, 3); // part of a unit still needs a label
});

test('products pasted as "barcode; name; code; qty"', () => {
  const [p] = productsFromText('4860103711939; ზეთი 1ლ; 10234; 12');
  assert.equal(p.title, 'ზეთი 1ლ');
  assert.equal(p.qty, 12);
});

test('assets: the accounting code is the number; QR links to the card; no code → INV', () => {
  const a = assetsFromRows(
    [
      ['ბუღალტრული კოდი', 'დასახელება'],
      ['FA-0012', 'ლეპტოპი'],
      ['', 'სკამი'],
      ['FA-0012', 'დუბლი'],
    ],
    1,
    'https://app.inverse.ge/',
  );
  assert.equal(a.length, 2);
  assert.equal(a[0].code, 'FA-0012');
  assert.equal(a[0].sub, undefined);
  assert.equal(a[0].qr, 'https://app.inverse.ge/inv/FA-0012');
  assert.equal(a[1].code, 'INV-0001');
  assert.equal(a[1].qr, 'https://app.inverse.ge/inv/INV-0001');
});

test('Georgian letters cannot be barcoded', () => {
  assert.deepEqual(
    notBarcodable([
      { code: 'ა-1', title: '' },
      { code: 'A-1', title: '' },
    ]),
    ['ა-1'],
  );
});
