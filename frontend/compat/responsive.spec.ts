import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  // No real provider requests, microphone access, or paid requests during CI.
  await page.route('https://js.puter.com/**', r => r.abort());
  await page.addInitScript(() => {
    (window as any).__auditMicCalls = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
      (window as any).__auditMicCalls++;
      throw new Error('Microphone use is not allowed in this audit');
    };
  });
});

const panels = ['', 'account', 'voice', 'privacy', 'advanced', 'data-export', 'debug', 'shared', 'tools', 'vault', 'reminders', 'memory', 'memory-search', 'timeline', 'conversations'];
for (const panel of panels) test(`panel ${panel || 'directory'}: responsive, accessible, no automatic microphone`, async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/control' + (panel ? `?panel=${panel}` : ''));
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await expect(page.getByRole('heading').first()).toBeVisible();
  if (panel) await expect(page.locator('.control-panel > :not(.panel-loading)').first()).toBeVisible();
  if (panel === 'vault') await expect(page.getByLabel('Master password')).toBeVisible();
  if (panel === 'shared' || panel === 'account') await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
  if (panel === 'memory-search') await expect(page.getByLabel('Words to find')).toBeVisible();
  await expect(page.getByText('Opening encrypted storage…')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  await info.attach('accessibility-results', { body: JSON.stringify(scan.violations, null, 2), contentType: 'application/json' });
  expect(scan.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => (window as any).__auditMicCalls)).toBe(0);
});

test('long mixed-language capture survives review, reload, and editing', async ({ page }) => {
  const title = 'मायाची नोंद · Maya — ' + 'longword'.repeat(24);
  await page.goto('/');
  await page.getByLabel('Capture a thought', { exact: true }).fill(title);
  await page.getByRole('button', { name: 'Review capture', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review your capture' });
  await expect(review).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole('button', { name: 'Save 1 item', exact: true }).click();
  await expect(page.locator('.record-row')).toHaveCount(1);
  await page.reload();
  await page.locator('.record-row').click();
  await expect(page.getByRole('dialog', { name: 'The full context' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('320px, landscape, large text and reduced motion keep primary actions reachable', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    for (const path of ['/', '/control', '/control?panel=voice', '/control?panel=reminders', '/control?panel=vault']) {
      await page.goto(path);
      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
      if (path.includes('panel=')) await expect(page.locator('.control-panel > :not(.panel-loading)').first()).toBeVisible();
      await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path} at ${viewport.width}px`).toBe(true);
    }
  }
});

test('corrupted saved settings cannot crash the voice panel or grant permission', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('onebrain-settings', JSON.stringify({ settings: { voiceSpeed: 'broken', language: {}, memoryEnabled: 'false', proactive: { enabled: 'true' } } })));
  await page.goto('/control?panel=voice');
  await expect(page.getByText('Voice speed · 1.0×')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__auditMicCalls)).toBe(0);
});

test('memory-off reminders have an explicit blocked state', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('onebrain-settings', JSON.stringify({ settings: { memoryEnabled: false } })));
  await page.goto('/control?panel=reminders');
  await expect(page.getByRole('button', { name: 'Add reminder', exact: true })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Enable saved memory', exact: true })).toBeVisible();
});

test('keyboard focus, Escape and Back retain a usable two-screen flow', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Capture a thought', { exact: true }).fill('Keyboard access test');
  await page.getByRole('button', { name: 'Review capture', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Your space', exact: true }).click();
  await page.getByLabel('Find a tool or setting').fill('vault');
  await page.locator('.control-entry').click();
  await expect(page).toHaveURL(/panel=vault/);
  await page.goBack();
  await expect(page.getByLabel('Find a tool or setting')).toBeVisible();
});

test('saved conversation messages appear once and search includes older conversations', async ({ page }) => {
  await page.goto('/control?panel=conversations');
  await expect(page.getByRole('button', { name: 'New conversation', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('onebrain');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction(['conversations', 'messages'], 'readwrite');
        tx.objectStore('conversations').put({ id: 'older', title: 'Older chat', createdAt: 1 });
        tx.objectStore('conversations').put({ id: 'latest', title: 'Latest chat', createdAt: 2 });
        for (const m of [
          { uuid: 'older-message', conversationId: 'older', role: 'user', content: 'Orchid project archived context', createdAt: 1 },
          { uuid: 'latest-question', conversationId: 'latest', role: 'user', content: 'Latest unique question', createdAt: 2 },
          { uuid: 'latest-answer', conversationId: 'latest', role: 'assistant', content: 'Latest unique answer', createdAt: 3 },
        ]) tx.objectStore('messages').add(m);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.goto('/control?panel=conversation&id=latest');
  await expect(page.getByText('2 messages', { exact: true })).toBeVisible();
  await expect(page.getByText('Latest unique question', { exact: true })).toHaveCount(1);
  await expect(page.getByText('Orchid project archived context', { exact: true })).toHaveCount(0);
  await page.goto('/control?panel=memory-search');
  await page.getByLabel('Words to find').fill('Orchid');
  await expect(page.getByText('Orchid project archived context', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: /Orchid project archived context/ }).click();
  await expect(page).toHaveURL(/id=older/);
  await expect(page.getByText('1 messages', { exact: true })).toBeVisible();
});

test('blocked vault storage ends in a recoverable error, not an endless loader', async ({ page }) => {
  await page.addInitScript(() => {
    indexedDB.open = () => { throw new DOMException('Storage blocked for audit', 'SecurityError'); };
  });
  await page.goto('/control?panel=vault');
  await expect(page.getByRole('button', { name: 'Reload vault storage', exact: true })).toBeVisible();
  await expect(page.getByText(/Vault storage is unavailable or corrupt/)).toBeVisible();
  await expect(page.getByText('Opening encrypted storage…')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create encrypted vault', exact: true })).toHaveCount(0);
});

test('blocked preference writes explain session-only changes', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException('Quota exceeded for audit', 'QuotaExceededError'); };
  });
  await page.goto('/control?panel=voice');
  await page.getByRole('combobox', { name: 'Answer length', exact: true }).selectOption('long');
  await expect(page.locator('.workspace-notice[role=alert]')).toContainText('Preferences could not be saved');
});

test('Today and capture review have no detected WCAG A/AA violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByLabel('Capture a thought', { exact: true })).toBeVisible();
  const scan = () => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect((await scan()).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
  await page.getByLabel('Capture a thought', { exact: true }).fill('Accessible review');
  await page.getByRole('button', { name: 'Review capture', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Review your capture' })).toBeVisible();
  expect((await scan()).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
});
