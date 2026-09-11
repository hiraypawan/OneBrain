import {defineConfig} from '@playwright/test';
import base from './playwright.config';
process.env.PLAYWRIGHT_BASE_URL ||= 'http://127.0.0.1:3001';
export default defineConfig({
 ...base,
 outputDir:'./edge-test-results',
 testMatch:['**/capacity.spec.ts','**/audit-auth.spec.ts','**/operations.spec.ts'],
 use:{...base.use,baseURL:process.env.PLAYWRIGHT_BASE_URL},
 webServer:process.env.CI?[
  {command:'npm --prefix ../workers/api run dev',url:'http://127.0.0.1:8787/api/health',timeout:120000},
  // The broken HTTP fallback makes these tests prove the service binding works.
  {command:'npx wrangler dev --local --ip 0.0.0.0 --port 3001 --inspector-port 9230 --var PLATFORM_API_URL:http://127.0.0.1:1',url:'http://127.0.0.1:3001/api/platform/capabilities',timeout:120000},
 ]:undefined,
});
