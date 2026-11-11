import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';
import { markAllRead } from '../me-actions';

export const metadata = { title: 'შეტყობინებები' };

const KIND: Record<string, string> = {
  update: '🆕 განახლება',
  info: 'ℹ️ ინფორმაცია',
  warning: '⚠️ ყურადღება',
};

/** Every system notification: app updates and notices, newest first. */
export default async function NotificationsPage() {
  const { userId } = await requireSession();
  const supabase = await createClient();
  const [{ data: notes }, { data: reads }] = await Promise.all([
    supabase
      .from('app_notifications')
      .select('id, kind, title, body, link, created_at')
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.from('app_notification_reads').select('notification_id').eq('user_id', userId),
  ]);
  const read = new Set((reads ?? []).map((r) => r.notification_id as string));
  const unread = (notes ?? []).filter((n) => !read.has(n.id)).length;
  return (
    <div className="grid gap-4 rounded-2xl bg-paper-sunk p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">შეტყობინებები</h1>
        {unread > 0 && <span className="text-sm text-ink-faint">{unread} წაუკითხავი</span>}
        {unread > 0 && (
          <form action={markAllRead} className="ml-auto">
            <button
              type="submit"
              className="rounded-full border border-rule-strong px-4 py-2 text-sm hover:bg-ink/5"
            >
              ✓ ყველა წაკითხულია
            </button>
          </form>
        )}
      </div>
      <ul className="grid gap-2">
        {(notes ?? []).map((n) => (
          <li
            key={n.id}
            className={`rounded-xl border px-4 py-3 ${read.has(n.id) ? 'border-rule' : 'border-accent/50 bg-accent/5'}`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-semibold">{n.title}</p>
              <span className="text-xs text-ink-faint">
                {KIND[n.kind] ?? n.kind} ·{' '}
                {new Date(n.created_at).toLocaleString('ka-GE', {
                  day: '2-digit',
                  month: '2-digit',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                  hourCycle: 'h23',
                  timeZone: 'Asia/Tbilisi',
                })}
              </span>
            </div>
            {n.body && <p className="mt-1 text-sm text-ink-soft">{n.body}</p>}
            {n.link && (
              <Link
                href={n.link}
                className="mt-1 inline-block text-sm font-medium text-accent hover:underline"
              >
                ნახვა →
              </Link>
            )}
          </li>
        ))}
        {(notes ?? []).length === 0 && <li className="text-sm text-ink-faint">ჯერ არაფერია.</li>}
      </ul>
    </div>
  );
}
