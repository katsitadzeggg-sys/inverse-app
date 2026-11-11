import { cookies } from 'next/headers';
import { requireSession } from '@/lib/session';
import { inputClass } from '@/components/ui';
import { setTheme, updateMyName } from '../me-actions';

export const metadata = { title: 'ჩემი პროფილი' };

const ROLE: Record<string, string> = {
  owner: 'მფლობელი',
  admin: 'მენეჯერი',
  member: 'აღწერის თანამშრომელი',
  viewer: 'მნახველი',
};

/** The person's own page: name, email, company, role and the theme. */
export default async function ProfilePage() {
  const { profile, company } = await requireSession();
  const theme = (await cookies()).get('inv_theme')?.value === 'dark' ? 'dark' : 'light';
  const row = 'grid gap-1 sm:grid-cols-[12rem_1fr] sm:items-center';
  return (
    <div className="grid max-w-2xl gap-4 rounded-2xl bg-paper-sunk p-5">
      <h1 className="text-xl font-semibold tracking-tight">ჩემი პროფილი</h1>
      <form action={updateMyName} className={row}>
        <label htmlFor="full_name" className="text-sm text-ink-soft">
          სახელი და გვარი
        </label>
        <div className="flex gap-2">
          <input
            id="full_name"
            name="full_name"
            defaultValue={profile.full_name ?? ''}
            required
            className={`${inputClass} flex-1`}
          />
          <button
            type="submit"
            className="rounded-full bg-[#1f7a4d] px-4 text-sm font-semibold text-white hover:bg-[#155c39]"
          >
            შენახვა
          </button>
        </div>
      </form>
      <div className={row}>
        <span className="text-sm text-ink-soft">ელ-ფოსტა</span>
        <span>{profile.email}</span>
      </div>
      <div className={row}>
        <span className="text-sm text-ink-soft">კომპანია</span>
        <span>{company.name}</span>
      </div>
      <div className={row}>
        <span className="text-sm text-ink-soft">როლი</span>
        <span>{ROLE[profile.role] ?? profile.role}</span>
      </div>
      <div className={row}>
        <span className="text-sm text-ink-soft">თემა</span>
        <span className="flex gap-2">
          {(['light', 'dark'] as const).map((t) => (
            <form key={t} action={setTheme.bind(null, t)}>
              <button
                type="submit"
                className={`rounded-full border px-4 py-2 text-sm ${theme === t ? 'border-accent bg-accent/10 font-semibold' : 'border-rule-strong hover:bg-ink/5'}`}
              >
                {t === 'light' ? '☀️ ღია' : '🌙 მუქი'}
              </button>
            </form>
          ))}
        </span>
      </div>
      <form action="/auth/signout" method="post" className="border-t border-rule pt-4">
        <button
          type="submit"
          className="rounded-full border border-mismatch/50 px-4 py-2 text-sm text-mismatch"
        >
          ↪ გასვლა
        </button>
      </form>
    </div>
  );
}
