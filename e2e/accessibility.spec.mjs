import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const baseUrl = process.env.ACCESSIBILITY_BASE_URL || 'http://127.0.0.1:4173';

test('mission control has no blocking accessibility violations', async ({ page }) => {
  await page.goto(`${baseUrl}/index.html`, { waitUntil: 'networkidle' });
  const results = await new AxeBuilder({ page }).analyze();
  const blockingViolations = results.violations.filter(({ impact }) => (
    impact === 'critical' || impact === 'serious'
  ));
  expect(blockingViolations).toEqual([]);
});
