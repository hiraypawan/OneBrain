/** @type {import('next').NextConfig} */
const isPagesExport = process.env.PAGES_EXPORT === '1';
const nextConfig = {
  reactStrictMode: true,
  // Static export ONLY for the Cloudflare Pages build (PAGES_EXPORT=1).
  // Local dev and the Workers build are unaffected.
  ...(isPagesExport ? { output: 'export', images: { unoptimized: true } } : {}),
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || '',
    NEXT_PUBLIC_BUILD_ID: `${process.env.NODE_ENV || 'development'}-${Date.now()}`,
  },
  async rewrites() {
    const backend = process.env.BACKEND_URL;
    return backend ? [{ source: '/backend/:path*', destination: `${backend}/:path*` }] : [];
  },
  // In dev: never let the browser cache pages, so you always see fresh code.
  async headers() {
    const vault = {source:'/vault',headers:[{key:'Content-Security-Policy',value:"default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; form-action 'none'; object-src 'none'; base-uri 'none'"},{key:'Referrer-Policy',value:'no-referrer'},{key:'Cache-Control',value:'no-store'}]};
    if (process.env.NODE_ENV === 'production') return [vault];
    return [vault,
      {
        source: '/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
    ];
  },
};

module.exports = nextConfig;
