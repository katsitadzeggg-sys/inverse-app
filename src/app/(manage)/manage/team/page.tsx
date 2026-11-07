import { redirect } from 'next/navigation';

/** Staff now live in the control panel. */
export default function TeamPage() {
  redirect('/manage/sites#team');
}
