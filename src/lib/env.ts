/** Reads an env var, failing loudly at the call site instead of silently sending `undefined`. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

export const supabaseUrl = () => required('NEXT_PUBLIC_SUPABASE_URL');
export const supabaseAnonKey = () => required('NEXT_PUBLIC_SUPABASE_ANON_KEY');
export const anthropicApiKey = () => required('ANTHROPIC_API_KEY');

/**
 * Whether this deployment has a Supabase project behind it.
 *
 * A preview deployment often does not. Without this check the proxy would throw
 * on every request and take the public pages down with it, so the signed-in half
 * of the app degrades on its own instead.
 *
 * Both names are read as full literals because Next.js inlines
 * `process.env.NEXT_PUBLIC_*` at build time only when it can see the whole
 * expression — a computed lookup would come back undefined in the browser.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
