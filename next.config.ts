import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Book files and photos go through server actions; Vercel accepts up to 4.5 MB.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};

export default nextConfig;
