import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Book files and photos go through server actions; Vercel accepts up to 4.5 MB.
  experimental: {
    serverActions: { bodySizeLimit: '4mb' },
    // Pages already visited open from the browser's cache for 30 s (Back, the
    // main page) instead of being rebuilt on the server each time; any change
    // made through the app refreshes them anyway.
    staleTimes: { dynamic: 30 },
  },
};

export default nextConfig;
