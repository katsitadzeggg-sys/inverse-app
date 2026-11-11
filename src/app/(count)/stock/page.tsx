import type { Metadata } from 'next';
import CounterHome from '../count/counter-home';

// Its own home-screen app: name, icon and start page differ from the fixed-assets one.
export const metadata: Metadata = {
  title: 'მარაგები',
  manifest: '/stock.webmanifest',
  appleWebApp: { capable: true, title: 'Inverse მარაგები', statusBarStyle: 'black' },
};

/** Stock counter app (home screen: /stock). */
export default function StockHome() {
  return <CounterHome app="stock" />;
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#1b120b',
};
