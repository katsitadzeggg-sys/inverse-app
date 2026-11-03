import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { supabaseAnonKey, supabaseUrl } from '@/lib/env';

/**
 * Request-scoped Supabase client. Every query runs as the signed-in user, so RLS
 * — not application code — is what keeps one company's rows away from another's.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies; the proxy refreshes the
          // session on every request, so this is safe to ignore here.
        }
      },
    },
  });
}
