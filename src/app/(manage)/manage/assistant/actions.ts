'use server';

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { anthropicApiKey } from '@/lib/env';
import { TOOLS, runTool } from '@/lib/assistant/tools';

export type ChatTurn = { role: 'user' | 'assistant'; text: string };

const MODEL = 'claude-sonnet-5-5';
const MAX_ROUNDS = 8;

let client: Anthropic | undefined;

/**
 * One question to the assistant. It answers only from this company's data,
 * read through the tools; the conversation lives in the browser and comes
 * back with each question.
 */
export async function askAssistant(
  history: ChatTurn[],
): Promise<{ text?: string; error?: string }> {
  const { company, profile } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin')
    return { error: 'ასისტენტი მხოლოდ მენეჯერისთვისაა.' };
  if (!process.env.ANTHROPIC_API_KEY)
    return { error: 'AI-ს გასაღები (ANTHROPIC_API_KEY) Vercel-ში ჯერ არ ჩაწერილა.' };
  const turns = history.filter((t) => t.text.trim()).slice(-20);
  if (!turns.length || turns.at(-1)!.role !== 'user') return { error: 'კითხვა ცარიელია.' };

  client ??= new Anthropic({ apiKey: anthropicApiKey() });
  const db = await createClient();
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tbilisi' });
  const system =
    `You are the Inverse assistant for the company "${company.name}" — an inventory (stocktake) app. ` +
    `Today is ${today}. Answer in Georgian, short and plain, with numbers from the tools. ` +
    'Use only what the tools return; if they do not have it, say so — never guess figures. ' +
    'You can only read data, not change it. Talk about this company only. ' +
    'Money is in GEL (₾). "ნაკლებობა" = shortage (counted < book), "ზედმეტობა" = surplus. ' +
    'When listing several products, use a short list with name, book, counted, difference.';

  const messages: Anthropic.MessageParam[] = turns.map((t) => ({ role: t.role, content: t.text }));
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 2000,
        system,
        tools: TOOLS,
        messages,
      });
      if (res.stop_reason !== 'tool_use') {
        const text = res.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        return { text: text || 'პასუხი ვერ მივიღე.' };
      }
      messages.push({ role: 'assistant', content: res.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const b of res.content)
        if (b.type === 'tool_use') {
          let out: unknown;
          try {
            out = await runTool(db, company.id, b.name, (b.input ?? {}) as Record<string, unknown>);
          } catch (e) {
            out = { error: e instanceof Error ? e.message : String(e) };
          }
          results.push({
            type: 'tool_result',
            tool_use_id: b.id,
            content: JSON.stringify(out).slice(0, 60000),
          });
        }
      messages.push({ role: 'user', content: results });
    }
    return { error: 'კითხვა ძალიან რთული აღმოჩნდა — სცადე უფრო კონკრეტულად.' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `ასისტენტმა ვერ უპასუხა: ${msg.slice(0, 200)}` };
  }
}
