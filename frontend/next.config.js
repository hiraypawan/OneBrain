/** @type {import('next').NextConfig} */
const isPagesExport = process.env.PAGES_EXPORT === '1';
const nextConfig = {
  reactStrictMode: true,
  // Static export ONLY for the Cloudflare Pages build (PAGES_EXPORT=1).
  // Local dev and the Workers build are unaffected.
  ...(isPagesExport ? { output: 'export', images: { unoptimized: true } } : {}),
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000',
    NEXT_PUBLIC_BUILD_ID: `${process.env.NODE_ENV || 'development'}-${Date.now()}`,
  },
  // In dev: never let the browser cache pages, so you always see fresh code.
  async headers() {
    if (process.env.NODE_ENV === 'production') return [];
    return [
      {
        source: '/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
    ];
  },
};

module.exports = nextConfig;
