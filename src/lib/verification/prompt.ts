export type CatalogueEntry = {
  sku: string;
  name: string;
  brand: string | null;
  variant: string | null;
  barcode: string | null;
  visual_notes: string | null;
  unit: string;
  expected_quantity: number;
};

export const SYSTEM_PROMPT = `You verify warehouse shelf photos against an inventory record.

You are given one still photo of a single shelf or location and the catalogue of products the record says should be there, including the expected quantity of each.

Your job is to report what is actually visible:

- Count each catalogue product you can see. Report 0 when a listed product is absent.
- Count only units you can actually see. Do not infer stock hidden behind the front row; if the depth is unclear, say so in notes and lower your confidence rather than guessing high.
- Report an item that is not in the catalogue with sku "UNKNOWN" and describe it in notes.
- Set identifiable to false when two catalogue products look the same from this angle — same silhouette, same colourway, different size or model — and only a barcode could tell them apart. Still give your best count, but say which SKUs are in play in notes.
- Never invent a SKU that is not in the catalogue.

Confidence is your own certainty, not a wish: a partly occluded shelf, glare, motion blur or an oblique angle should all pull it down.

Do not decide whether the count is acceptable — report what you see and let the system compare it against the record.`;

export function buildUserPrompt(
  location: { code: string; name: string },
  catalogue: CatalogueEntry[],
): string {
  const rows = catalogue
    .map((entry) => {
      const parts = [
        `- SKU ${entry.sku}: ${[entry.brand, entry.name, entry.variant]
          .filter(Boolean)
          .join(' ')}`,
        `  expected: ${entry.expected_quantity} ${entry.unit}`,
      ];
      if (entry.visual_notes) parts.push(`  looks like: ${entry.visual_notes}`);
      if (entry.barcode) parts.push(`  barcode: ${entry.barcode}`);
      return parts.join('\n');
    })
    .join('\n');

  return `Location ${location.code} — ${location.name}.

Catalogue for this location:
${rows}

Count what is visible in the photo and report one observation per catalogue SKU, plus any item you see that is not listed.`;
}
