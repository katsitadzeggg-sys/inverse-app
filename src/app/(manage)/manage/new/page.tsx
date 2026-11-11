import { redirect } from 'next/navigation';

/** A new stocktake opens in the drawer of the stocktakes table. */
export default async function NewStocktake({ searchParams }: PageProps<'/manage/new'>) {
  const sp = await searchParams;
  const kind =
    typeof sp.kind === 'string' && ['stock', 'expiry', 'assets'].includes(sp.kind)
      ? sp.kind
      : 'stock';
  redirect(`/manage/stocktakes?kind=${kind}&add=1`);
}
