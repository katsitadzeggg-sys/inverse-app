import TeamSection from './team-section';

export const metadata = { title: 'გუნდი და როლები' };

/** Staff: its own page in the menu (invite, modules, book permission, remove). */
export default function TeamPage() {
  return (
    <div className="rounded-2xl bg-paper-sunk p-5">
      <TeamSection />
    </div>
  );
}
