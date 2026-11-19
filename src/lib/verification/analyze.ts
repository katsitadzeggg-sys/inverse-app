import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { anthropicApiKey } from '@/lib/env';
import { ShelfAnalysisSchema, type ShelfAnalysis } from './schema';
import { buildUserPrompt, SYSTEM_PROMPT, type CatalogueEntry } from './prompt';

export const VISION_MODEL = 'claude-opus-5-5';

export type SupportedImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export const SUPPORTED_IMAGE_TYPES: SupportedImageType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

export function isSupportedImageType(value: string): value is SupportedImageType {
  return (SUPPORTED_IMAGE_TYPES as string[]).includes(value);
}

export type AnalyzeInput = {
  image: Buffer;
  mediaType: SupportedImageType;
  location: { code: string; name: string };
  catalogue: CatalogueEntry[];
};

export type AnalyzeResult = {
  analysis: ShelfAnalysis;
  model: string;
  inputTokens: number;
  outputTokens: number;
};

let client: Anthropic | undefined;

function getClient(): Anthropic {
  client ??= new Anthropic({ apiKey: anthropicApiKey() });
  return client;
}

/**
 * Sends one still shelf photo to Claude and gets back a structured count.
 *
 * Claude reads static images, not live video, so the flow is deliberately
 * capture-then-analyze: the caller freezes a frame, we analyze that frame.
 */
export async function analyzeShelfPhoto({
  image,
  mediaType,
  location,
  catalogue,
}: AnalyzeInput): Promise<AnalyzeResult> {
  const response = await getClient().messages.parse({
    model: VISION_MODEL,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    output_config: {
      format: zodOutputFormat(ShelfAnalysisSchema),
    },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mediaType,
              data: image.toString('base64'),
            },
          },
          { type: 'text', text: buildUserPrompt(location, catalogue) },
        ],
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error(
      `Claude declined to analyze this image (${response.stop_details?.category ?? 'unspecified'}).`,
    );
  }

  if (!response.parsed_output) {
    throw new Error('Claude returned a response that did not match the expected schema.');
  }

  return {
    analysis: response.parsed_output,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

export type ShelfImage = { data: Buffer; mediaType: SupportedImageType };

/**
 * Several photos (and frames cut from videos) of one shelf at once — a blind
 * count: the model is not told what was counted, so a match is an independent
 * confirmation and not the model repeating the number it was given. The model
 * reports one total per product across all of them, without counting a unit
 * twice when photos overlap. Notes and summary come back in Georgian.
 */
export async function analyzeShelfImages({
  images,
  location,
  catalogue,
}: {
  images: ShelfImage[];
  location: { code: string; name: string };
  catalogue: CatalogueEntry[];
}): Promise<AnalyzeResult> {
  const response = await getClient().messages.parse({
    model: VISION_MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    output_config: {
      format: zodOutputFormat(ShelfAnalysisSchema),
    },
    messages: [
      {
        role: 'user',
        content: [
          ...images.flatMap((im, i) => [
            { type: 'text' as const, text: `Image ${i + 1}` },
            {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: im.mediaType,
                data: im.data.toString('base64'),
              },
            },
          ]),
          {
            type: 'text',
            text:
              buildUserPrompt(location, catalogue, true) +
              `

There are ${images.length} images of this same shelf (photos, and frames taken from videos).
They overlap: give ONE total per product for the whole shelf, never adding up the same units seen in two images.
You are not told how many were counted: count independently, from the images only.
For each product also give boxes: on every image where it is visible, one tight box around each
group of its units (at most 6 boxes per product per image), as fractions of that image's width and
height. Use the image number written before each image.
Write notes and summary in Georgian, short and plain.`,
          },
        ],
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('მოდელმა ფოტოების შემოწმებაზე უარი თქვა.');
  }
  if (!response.parsed_output) {
    throw new Error('მოდელის პასუხი ვერ წავიკითხე.');
  }
  return {
    analysis: response.parsed_output,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
