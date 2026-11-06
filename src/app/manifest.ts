import type { MetadataRoute } from 'next';

/** Installs the counter's app on the phone's home screen ("Add to Home Screen"). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Inverse — ინვენტარიზაცია',
    short_name: 'Inverse',
    description: 'ინვენტარიზაცია ტელეფონით',
    start_url: '/count',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f172a',
    theme_color: '#0f172a',
    lang: 'ka',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
