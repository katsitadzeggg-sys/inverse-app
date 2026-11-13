import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { anthropicApiKey } from '@/lib/env';
import type { SupportedImageType } from './analyze';

/** Fast enough to answer while the counter waits at the shelf. */
export const IDENTIFY_MODEL = 'claude-sonnet-5-5';

export const IdentifySchema = z.object({
  label_text: z
    .string()
    .describe('The main text printed on the product, as written (brand, name, size). Empty if none.'),
  name_guess: z
    .string()
    .describe('A short product name to search a warehouse list with, e.g. "ზედაზენი ლიმონათი 0.5ლ".'),
  barcode_digits: z
    .string()
    .describe('Barcode digits if they are readable under the bars, else empty string.'),
  matches: z
    .array(
      z.object({
        ref: z.string().describe('The ref of a candidate from the list'),
        confidence: z.number().min(0).max(1),
      }),
    )
    .describe('Up to 3 candidates from the list that this could be, best first. Empty if none fit.'),
});
export type Identify = z.infer<typeof IdentifySchema>;

export type Candidate = {
  ref: string;
  name: string;
  brand?: string | null;
  variant?: string | null;
  notes?: string | null;
};

let client: Anthropic | undefined;

/**
 * One photo of one product (barcode unreadable, torn, missing): read what is
 * printed on it and pick the likeliest products from the candidate list.
 */
export async function identifyProduct({
  image,
  mediaType,
  candidates,
}: {
  image: Buffer;
  mediaType: SupportedImageType;
  candidates: Candidate[];
}): Promise<Identify> {
  client ??= new Anthropic({ apiKey: anthropicApiKey() });
  const list = candidates
    .map(
      (c) =>
        `${c.ref} | ${c.name}${c.brand ? ` | ${c.brand}` : ''}${c.variant ? ` | ${c.variant}` : ''}${c.notes ? ` | ${c.notes}` : ''}`,
    )
    .join('\n');
  const response = await client.messages.parse({
    model: IDENTIFY_MODEL,
    max_tokens: 1500,
    system:
      'You identify a single retail or warehouse product from a phone photo for a stocktake. ' +
      'Read the printed text exactly; do not invent text you cannot see. ' +
      'Only list a candidate when brand, name and size/variant are consistent with the photo. ' +
      'Same brand but a different size or flavour is NOT a match.',
    output_config: { format: zodOutputFormat(IdentifySchema) },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: image.toString('base64') },
          },
          {
            type: 'text',
            text: candidates.length
              ? `Candidates (ref | name | brand | variant | notes):\n${list}`
              : 'No candidate list: just read the product.',
          },
        ],
      },
    ],
  });
  if (response.stop_reason === 'refusal') throw new Error('მოდელმა ფოტოზე უარი თქვა.');
  if (!response.parsed_output) throw new Error('მოდელის პასუხი ვერ წავიკითხე.');
  return response.parsed_output;
}
