import type { Metadata } from 'next';
import { APP_URL } from '@/lib/site-url';
import localFont from 'next/font/local';
import './globals.css';

/*
  Body face: Helvetica Neue LT Georgian, licensed by the client, who holds the
  rights for this use. Covers Latin and the full mkhedruli range, including the
  lari sign, in three weights.
*/
const body = localFont({
  src: [
    { path: './fonts/helvetica-neue-geo-45.woff2', weight: '300', style: 'normal' },
    { path: './fonts/helvetica-neue-geo-55.woff2', weight: '400', style: 'normal' },
    { path: './fonts/helvetica-neue-geo-75.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-body-loaded',
  display: 'swap',
});

/*
  Display face for headings and labels: condensed caps, Latin and Georgian.
  It carries no lari sign, so prices are set in the body face.
*/
const display = localFont({
  src: './fonts/bpg-paata-cond-caps.woff2',
  variable: '--font-display-loaded',
  display: 'swap',
  // The face is condensed; synthesised fallback metrics from a normal-width
  // font make the pre-swap text jump noticeably wider.
  adjustFontFallback: false,
});


export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: { default: 'Inverse', template: '%s · Inverse' },
  description: 'Inverse — inventory counts, discrepancies and evidence.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
        <html
      lang="ka-GE"
      className={`${body.variable} ${display.variable} h-full`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
