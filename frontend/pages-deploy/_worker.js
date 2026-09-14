// Production alias for https://onebrains.pages.dev
//
// OpenNext must run as a Worker (ASSETS binding + PLATFORM_API). Uploading that
// bundle as Pages `_worker.js` drops ASSETS, so HTML renders and CSS 404s —
// the unstyled phone UI. This file only forwards to the `onebrain` Worker.
export default {
  async fetch(request, env) {
    if (!env.APP) {
      return new Response('OneBrain app worker is not bound.', { status: 503 });
    }
    return env.APP.fetch(request);
  },
};
