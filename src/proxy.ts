import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

// The two counter apps (fixed assets at /count, stock at /stock) share the
// screens inside a stocktake; this cookie keeps the colour and home button of
// the app the counter came from.
const APP_HOME: Record<string, string> = { '/count': 'assets', '/stock': 'stock' };

export async function proxy(request: NextRequest) {
  const app = APP_HOME[request.nextUrl.pathname];
  if (app && request.cookies.get('inv_app')?.value !== app) request.cookies.set('inv_app', app);
  const response = await updateSession(request);
  if (app) response.cookies.set('inv_app', app, { path: '/', maxAge: 31536000, sameSite: 'lax' });
  return response;
}

export const config = {
  matcher: [
    /*
      Everything except static assets. The extension list has to cover every
      media type the site actually serves from /public: a request that slips
      through here is answered with an auth redirect instead of the file, which
      is how /video/*.mp4 briefly started returning 307s to /login.
    */
    '/((?!_next/static|_next/image|favicon.ico|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|mp4|webm|ogg|mov|woff|woff2|ttf|otf|txt|xml|json|webmanifest|wasm|xlsx)$).*)',
  ],
};
