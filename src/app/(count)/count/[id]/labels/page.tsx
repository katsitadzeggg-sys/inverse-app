import { redirect } from 'next/navigation';

/** Labels now live in the manager's menu (light page); old links land there. */
export default async function LabelsPage({
  params,
  searchParams,
}: PageProps<'/count/[id]/labels'>) {
  const { id } = await params;
  const sp = await searchParams;
  const q = new URLSearchParams({ st: id });
  if (typeof sp.src === 'string') q.set('src', sp.src);
  if (sp.all === '1') q.set('all', '1');
  redirect(`/manage/labels?${q}`);
}
