import TeamSection from './team-section';
import AiSwitch from './ai-switch';
import { requireSession } from '@/lib/session';

export const metadata = { title: 'გუნდი და როლები' };

/** Staff: its own page in the menu (invite, modules, book permission, remove). */
export default async function TeamPage() {
  const { company, profile } = await requireSession();
  const manager = profile.role === 'owner' || profile.role === 'admin';
  return (
    <div className="grid gap-4 rounded-2xl bg-paper-sunk p-5">
      {manager && <AiSwitch on={!!company.ai_shelf_check} />}
      <TeamSection />
    </div>
  );
}
