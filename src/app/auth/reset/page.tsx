import ResetForm from './reset-form';

export const metadata = { title: 'ახალი პაროლი' };

/** Where the "forgot password" email lands, already signed in: set a new password. */
export default function ResetPage() {
  return (
    <main className="flex flex-1 flex-col">
      <div className="mx-auto flex w-full max-w-5xl flex-1 items-start px-6 py-20">
        <div className="w-full max-w-sm">
          <h1 className="border-b border-ink pb-3 text-sm">ახალი პაროლი</h1>
          <ResetForm />
        </div>
      </div>
    </main>
  );
}
