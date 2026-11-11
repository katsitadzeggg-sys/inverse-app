import StocktakesView from '../stocktakes/stocktakes-view';

export const metadata = { title: 'არქივი' };

/** Archived stocktakes, their own tab in the menu. */
export default function ArchivePage({ searchParams }: PageProps<'/manage/archive'>) {
  return <StocktakesView searchParams={searchParams} archived />;
}
