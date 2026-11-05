/**
 * Upper-case Latin letters only. String.toUpperCase() turns Georgian
 * Mkhedruli (ა-ჰ) into Mtavruli capitals (Ა-Ჰ), which looked wrong on labels
 * and broke matching of Georgian codes and room names.
 */
export const upperLatin = (s: string) => s.replace(/[a-z]/g, (c) => c.toUpperCase());

/** Mtavruli capitals back to ordinary Georgian letters. */
export const mkhedruli = (s: string) => s.replace(/[Ა-Ჿ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x1c90 + 0x10d0));

/** Compare codes and room names: case of Latin letters, spaces and dashes do not matter. */
export const normKey = (s: string | null | undefined) => upperLatin(mkhedruli(s ?? '')).replace(/[^A-Z0-9ა-ჿ]+/g, '');
