import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * USD per million tokens (input, output), for the dashboard's estimate.
 * ⚠ Check against the current price list (platform.claude.com) when it changes.
 */
export const AI_PRICE: Record<string, [number, number]> = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
};

export const aiCost = (model: string, input: number, output: number) => {
  const [i, o] = AI_PRICE[model] ?? AI_PRICE['claude-opus-5-5'];
  return (input * i + output * o) / 1e6;
};

/**
 * Records one AI call's tokens. Never throws: a missing table (before
 * migration 0067) or a failed write must not break the answer.
 */
export async function logAiUsage(
  supabase: SupabaseClient,
  kind: 'assistant' | 'identify',
  model: string,
  usage: { input_tokens?: number | null; output_tokens?: number | null },
) {
  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    await supabase.from('ai_usage').insert({
      kind,
      model,
      user_id: data.user.id,
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
    });
  } catch {
    /* best effort */
  }
}
