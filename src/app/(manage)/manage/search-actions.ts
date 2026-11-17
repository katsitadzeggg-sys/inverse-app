'use server';

import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';

export type Hit = {
  kind: 'stocktake' | 'site' | 'person';
  title: string;
  sub: string;
  href: string;
};

/**
 * The dashboard's one search across the system: stocktakes (number, client,
 * branch, name), warehouses / objects and staff. RLS keeps it to the
 * viewer's company; the explicit company filter is a second guard.
 */
export async function searchAll(raw: string): Promise<Hit[]> {
  const { company, profile } = await requireSession();
  if (profile.role !== 'owner' && profile.role !== 'admin') return [];
  const q = raw.replace(/[%_,()\\"'*]/g, ' ').trim();
  if (q.length < 2) return [];
  const like = `%${q}%`;
  const supabase = await createClient();
  const [{ data: st }, { data: sites }, { data: people }] = await Promise.all([
    supabase
      .from('stocktakes')
      .select('id, number, name, client_name, branch, kind, status, archived_at')
      .eq('company_id', company.id)
      .or(['number', 'client_name', 'branch', 'name'].map((c) => `${c}.ilike.${like}`).join(','))
      .order('created_at', { ascending: false })
      .limit(8),
    supabase
      .from('sites')
      .select('id, name, address')
      .eq('company_id', company.id)
      .or(`name.ilike.${like},address.ilike.${like}`)
      .order('name')
      .limit(5),
    supabase
      .from('user_profiles')
      .select('id, full_name, email, role')
      .eq('company_id', company.id)
      .or(`full_name.ilike.${like},email.ilike.${like}`)
      .limit(5),
  ]);
  const KIND: Record<string, string> = { stock: '📦', expiry: '⏳', assets: '🏷' };
  return [
    ...(st ?? []).map((s) => ({
      kind: 'stocktake' as const,
      title: `${KIND[s.kind] ?? ''} ${s.number}`,
      sub: [
        s.branch || s.client_name || s.name,
        s.archived_at ? 'არქივი' : s.status === 'open' ? 'მიმდინარე' : 'დახურული',
      ].join(' · '),
      href: `/manage/${s.id}`,
    })),
    ...(sites ?? []).map((s) => ({
      kind: 'site' as const,
      title: `🏬 ${s.name}`,
      sub: s.address ?? 'საწყობი / ობიექტი',
      href: `/manage/stocktakes?kind=all&q=${encodeURIComponent(s.name)}`,
    })),
    ...(people ?? []).map((p) => ({
      kind: 'person' as const,
      title: `👤 ${p.full_name || p.email}`,
      sub: p.full_name ? p.email : 'თანამშრომელი',
      href: '/manage/team',
    })),
  ];
}
