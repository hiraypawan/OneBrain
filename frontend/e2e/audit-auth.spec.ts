import { test, expect } from '@playwright/test';
import { seedServerSession } from './server-fixture';

test('a delayed identity hydration cannot sign a user back in after confirmed logout', async ({ page }) => {
  await page.route('https://js.puter.com/**', r => r.abort());
  await seedServerSession(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let held = false;
  await page.addInitScript(() => {
    (window as any).__identityReads = 0;
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (String(args[0]).endsWith('/api/platform/me')) {
        const json = response.json.bind(response);
        response.json = async () => { const value = await json(); (window as any).__identityReads++; return value; };
      }
      return response;
    };
  });
  await page.route('**/api/platform/me', async route => {
    if (held) return route.continue();
    held = true;
    const response = await route.fetch();
    await gate;
    await route.fulfill({ response });
  });
  await page.goto('/control?panel=voice');
  await expect.poll(() => held).toBe(true);
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name: 'Account', exact: true }).click();
  await expect(page.getByText('GOOGLE ACCOUNT · SESSION VERIFIED')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByText('Signed out of OneBrain. Local records have not been deleted.')).toBeVisible();
  release();
  await page.waitForFunction(() => (window as any).__identityReads >= 2);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByRole('link', { name: 'Sign in with Google', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Account settings', exact: true })).toHaveCount(0);
});
