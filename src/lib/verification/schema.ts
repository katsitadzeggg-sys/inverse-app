import { z } from 'zod';

/**
 * What the vision model is asked to return. It reports *perception only* —
 * what it can see and how sure it is. Turning that into a green/yellow/red
 * verdict happens in `grade.ts`, so the rule is deterministic and auditable.
 */
/** A rectangle on one image, in fractions of its width and height (0 = left/top). */
export const BoxSchema = z.object({
  image: z
    .number()
    .int()
    .min(1)
    .describe('Image number, as labelled before each image (1 = first)'),
  x0: z.number().min(0).max(1).describe('Left edge, fraction of image width'),
  y0: z.number().min(0).max(1).describe('Top edge, fraction of image height'),
  x1: z.number().min(0).max(1).describe('Right edge, fraction of image width'),
  y1: z.number().min(0).max(1).describe('Bottom edge, fraction of image height'),
});

export const ShelfObservationSchema = z.object({
  sku: z.string().describe('SKU from the provided catalogue, or "UNKNOWN" for an item not in it'),
  detected_quantity: z
    .number()
    .int()
    .min(0)
    .describe('How many units of this product are visible in the photo'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('0-1 certainty that this identification and count are correct'),
  identifiable: z
    .boolean()
    .describe(
      'False when another catalogue product looks the same from this angle and only a barcode could separate them',
    ),
  notes: z
    .string()
    .describe('Short reason for the count or the ambiguity. Empty string if nothing to add.'),
  boxes: z
    .array(BoxSchema)
    .describe(
      'Where this product is seen: one tight box around each group of its units, per image. Empty when not visible.',
    ),
});

export const ShelfAnalysisSchema = z.object({
  observations: z
    .array(ShelfObservationSchema)
    .describe('One entry per catalogue product you looked for, plus any unknown items'),
  image_quality: z
    .enum(['good', 'fair', 'poor'])
    .describe('Whether the photo is clear enough to count from'),
  summary: z.string().describe('One or two sentences a warehouse operator would find useful'),
});

export type Box = z.infer<typeof BoxSchema>;
export type ShelfObservation = z.infer<typeof ShelfObservationSchema>;
export type ShelfAnalysis = z.infer<typeof ShelfAnalysisSchema>;
