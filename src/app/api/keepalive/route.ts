import { createClient } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from '@/lib/env';

/**
 * Called once a day by Vercel Cron (vercel.json). A free Supabase project is
 * paused after a week without activity, and a paused database silently drops
 * contact-form requests and newsletter signups. One tiny query a day keeps it
 * awake. Nothing is read: RLS returns no rows to the anon role.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // When CRON_SECRET is set, Vercel sends it; anyone else gets a 401.
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  if (!isSupabaseConfigured()) return Response.json({ ok: false, reason: 'not configured' });

  const supabase = createClient(supabaseUrl(), supabaseAnonKey(), {
    auth: { persistSession: false },
  });
  const { error } = await supabase.from('newsletter_subscribers').select('id').limit(1);
  if (error) {
    console.error('keepalive query failed', error.code, error.message);
    return Response.json({ ok: false }, { status: 500 });
  }
  return Response.json({ ok: true });
}
