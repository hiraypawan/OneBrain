import type { Metadata, Viewport } from 'next';
import { ProviderScript } from '@/components/ProviderScript';
import './globals.css';
import './product.css';
import { StoreHydrator } from '@/components/StoreHydrator';
import { MainNav } from '@/components/MainNav';
import { InstallPrompt } from '@/components/InstallPrompt';

export const metadata: Metadata = {
  title: 'OneBrain — A little less to remember',
  description: 'Your voice-first assistant for notes, tasks and questions. Write or speak, review what gets saved, and find it again.',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" href="/icon-192.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body className="bg-black text-white min-h-screen">
        <StoreHydrator />
        <MainNav />
        <InstallPrompt />
        <main className="app-main">{children}</main>
        {/* Keyless AI engine (Puter.js): loads after interactive, fails silently offline */}
        <ProviderScript />
        <script
          dangerouslySetInnerHTML={{
            // Error trap: keeps the last 5 page errors where Debug can show them.
            // Localhost: actively evict any old service worker (it served stale
            // builds in the past). Production: register the PWA worker.
            __html: `window.__onebrain_errors=[];function __obe(m){try{window.__onebrain_errors.push(String(m).slice(0,300));var l=[];try{l=JSON.parse(localStorage.getItem('onebrain-errors')||'[]')}catch(_){}l.push({t:Date.now(),m:String(m).slice(0,300)});localStorage.setItem('onebrain-errors',JSON.stringify(l.slice(-5)))}catch(_){}}window.addEventListener('error',function(e){__obe((e&&e.message)||e)});window.addEventListener('unhandledrejection',function(e){__obe((e&&e.reason&&(e.reason.message||e.reason))||e)});if('serviceWorker' in navigator){var isLocal=/^(localhost|127\\.0\\.0\\.1)$/.test(location.hostname);window.addEventListener('load',function(){if(isLocal){navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister()})}).catch(function(){})}else{navigator.serviceWorker.register('/sw.js').catch(function(){})}})}`,
          }}
        />
      </body>
    </html>
  );
}
