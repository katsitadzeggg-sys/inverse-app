import { aiCheckShelf } from '@/app/(count)/count/ai-actions';

/**
 * The shelf photo check over plain HTTP. As a server action it held up every
 * other action on the page for up to a minute — Next.js runs a page's actions
 * one after another — so "დახურვა" waited for the check (Giorgi, 25.11). A
 * fetch runs beside them. Same checks inside: session, company, role.
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    stocktakeId?: unknown;
    locationId?: unknown;
    frames?: unknown;
    auto?: unknown;
  } | null;
  if (
    !body ||
    typeof body.stocktakeId !== 'string' ||
    typeof body.locationId !== 'string' ||
    !Array.isArray(body.frames) ||
    !body.frames.every((f) => typeof f === 'string')
  )
    return Response.json({ error: 'bad request' }, { status: 400 });
  const result = await aiCheckShelf(
    body.stocktakeId,
    body.locationId,
    (body.frames as string[]).slice(0, 16),
    body.auto === true,
  );
  return Response.json(result);
}
