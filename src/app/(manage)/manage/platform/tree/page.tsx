import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/session';

export const metadata = { title: 'აპის სტრუქტურა' };

/** ok = ready, fix = to rework (narrow etc.), old = old prototype to review. */
type State = 'ok' | 'fix' | 'old';
type Node = { label: string; href?: string; state: State; note?: string; kids?: Node[] };

const MANAGER: Node[] = [
  {
    label: 'დეშბორდი',
    href: '/manage',
    state: 'ok',
    kids: [{ label: '3D / ბადის რუკა', state: 'ok' }],
  },
  {
    label: 'ინვენტარიზაციები',
    href: '/manage/stocktakes',
    state: 'ok',
    kids: [
      {
        label: 'ინვენტარიზაცია',
        state: 'ok',
        kids: [
          { label: 'თარო (მენეჯერის)', state: 'ok' },
          { label: 'აქტი', state: 'ok' },
          { label: 'ნაშთი', state: 'ok' },
          { label: 'სხვაობები', state: 'fix', note: 'ვიწროა' },
          { label: 'რეესტრი (ძირ. საშ.)', state: 'fix', note: 'ვიწროა' },
        ],
      },
      { label: 'გამორჩენილი / გადასამოწმებელი', state: 'ok' },
      { label: 'ახალი ინვენტარიზაცია', href: '/manage/new', state: 'ok' },
    ],
  },
  { label: 'ობიექტები', href: '/manage/sites', state: 'ok' },
  { label: 'არქივი', href: '/manage/archive', state: 'ok' },
  { label: 'ციკლები', href: '/manage/cycles', state: 'ok' },
  { label: 'ეტიკეტები', href: '/manage/labels', state: 'ok' },
  { label: 'AI ასისტენტი', href: '/manage/assistant', state: 'ok' },
  { label: 'გუნდი და როლები', href: '/manage/team', state: 'ok' },
  {
    label: 'პლატფორმა',
    href: '/manage/platform',
    state: 'ok',
    kids: [{ label: 'აპის სტრუქტურა (ეს გვერდი)', state: 'ok' }],
  },
];

const COUNTER: Node[] = [
  { label: 'მთავარი (/count · /stock)', href: '/count', state: 'ok' },
  { label: 'თაროს არჩევა', state: 'ok' },
  { label: 'თაროს დათვლა (სკანერი)', state: 'ok' },
  { label: 'გადათვლის სია (№ რიგით)', state: 'ok' },
  { label: 'თარო დახურულია: ფოტო, AI', state: 'ok' },
];

const OLD: Node[] = ['/dashboard', '/checks', '/products', '/locations', '/verify'].map((p) => ({
  label: p,
  state: 'old' as const,
}));

const TONE: Record<State, string> = {
  ok: 'border-match/40 bg-match/10',
  fix: 'border-review/60 bg-review/15',
  old: 'border-rule-strong bg-paper-dim text-ink-faint',
};

function Branch({ nodes }: { nodes: Node[] }) {
  return (
    <ul className="space-y-1.5 border-l border-rule pl-4">
      {nodes.map((n) => (
        <li key={n.label}>
          <span
            className={`inline-flex items-center gap-2 rounded-control border px-2.5 py-1 text-sm ${TONE[n.state]}`}
          >
            {n.href ? (
              <Link href={n.href} className="hover:underline">
                {n.label}
              </Link>
            ) : (
              n.label
            )}
            {n.note && <span className="text-xs text-ink-faint">· {n.note}</span>}
          </span>
          {n.kids && (
            <div className="mt-1.5">
              <Branch nodes={n.kids} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Map of the app's pages and their state — for the platform owner. */
export default async function AppTreePage() {
  await requireSession();
  const supabase = await createClient();
  const { data: admin } = await supabase.rpc('is_platform_admin');
  if (!admin) redirect('/manage');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/manage/platform" className="text-sm text-ink-faint hover:text-ink">
            ← პლატფორმა
          </Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">აპის სტრუქტურა</h1>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className={`rounded-control border px-2 py-0.5 ${TONE.ok}`}>მზადაა</span>
          <span className={`rounded-control border px-2 py-0.5 ${TONE.fix}`}>გასასწორებელი</span>
          <span className={`rounded-control border px-2 py-0.5 ${TONE.old}`}>
            ძველი, შესამოწმებელი
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr_1fr]">
        <section className="rounded-control border border-rule bg-paper p-5">
          <h2 className="mb-3 font-semibold">მენეჯერი · კომპიუტერი</h2>
          <Branch nodes={MANAGER} />
        </section>
        <section className="rounded-control border border-rule bg-paper p-5">
          <h2 className="mb-3 font-semibold">აღმწერი · ტელეფონი</h2>
          <Branch nodes={COUNTER} />
        </section>
        <section className="rounded-control border border-rule bg-paper p-5">
          <h2 className="mb-3 font-semibold">ძველი ნაწილი</h2>
          <Branch nodes={OLD} />
          <p className="mt-3 text-xs text-ink-faint">
            არავისთვის ჩანს: ყველა მენეჯერთან ან აღმწერთან გადადის.
          </p>
        </section>
      </div>
    </div>
  );
}
