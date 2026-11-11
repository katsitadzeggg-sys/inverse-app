/**
 * Upper-case Latin letters only. String.toUpperCase() turns Georgian
 * Mkhedruli (ა-ჰ) into Mtavruli capitals (Ა-Ჰ), which looked wrong on labels
 * and broke matching of Georgian codes and room names.
 */
export const upperLatin = (s: string) => s.replace(/[a-z]/g, (c) => c.toUpperCase());

/** Mtavruli capitals back to ordinary Georgian letters. */
export const mkhedruli = (s: string) =>
  s.replace(/[Ა-Ჿ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x1c90 + 0x10d0));

/** Compare codes and room names: case of Latin letters, spaces and dashes do not matter. */
export const normKey = (s: string | null | undefined) =>
  upperLatin(mkhedruli(s ?? '')).replace(/[^A-Z0-9ა-ჿ]+/g, '');

/**
 * Phones turn a typed "--" into a long dash (—) and "-" sometimes into "–".
 * Shelf codes like "A--01" must stay as written.
 */
export const fixDashes = (s: string) =>
  s.replace(/\u2014/g, '--').replace(/[\u2013\u2012\u2212]/g, '-');

/**
 * Phone cameras read a 12-digit UPC-A barcode as EAN-13 with a leading 0
 * (095866005108 → 0095866005108). Both spellings mean the same product.
 */
export const barcodeKey = (c: string | null | undefined) => {
  const t = (c ?? '').trim();
  return /^0\d{12}$/.test(t) ? t.slice(1) : t;
};
export const sameBarcode = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && barcodeKey(a) === barcodeKey(b);
/** The spellings to look a scanned code up by. */
export const barcodeVariants = (c: string) => {
  const t = c.trim();
  if (/^0\d{12}$/.test(t)) return [t, t.slice(1)];
  if (/^\d{12}$/.test(t)) return [t, `0${t}`];
  return [t];
};
