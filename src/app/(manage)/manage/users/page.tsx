import { redirect } from 'next/navigation';

/** Registrations now live in the platform console, per company. */
export default function UsersPage() {
  redirect('/manage/platform');
}
