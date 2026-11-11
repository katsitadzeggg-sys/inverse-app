import StocktakesView from './stocktakes-view';

export const metadata = { title: 'ინვენტარიზაციები' };

/** Every current stocktake — stock, expiry, fixed assets — with a filter and "+". */
export default function StocktakesPage({ searchParams }: PageProps<'/manage/stocktakes'>) {
  return <StocktakesView searchParams={searchParams} archived={false} />;
}
