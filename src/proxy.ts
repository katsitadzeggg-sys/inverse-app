import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
      Everything except static assets. The extension list has to cover every
      media type the site actually serves from /public: a request that slips
      through here is answered with an auth redirect instead of the file, which
      is how /video/*.mp4 briefly started returning 307s to /login.
    */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|mp4|webm|ogg|mov|woff|woff2|ttf|otf|txt|xml|json|webmanifest)$).*)',
  ],
};
