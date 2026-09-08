import { test, expect } from '@playwright/test';

const canvasRooms = [
  ['index.html', 3], ['canvas.html', 1], ['connectors.html', 1],
  ['memory.html', 3], ['mission-control.html', 3], ['nexus-canvas.html', 3],
  ['queue.html', 1], ['room.html', 1], ['tenants.html', 2],
];

test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });

for (const [file, expectedPanels] of canvasRooms) {
  test(`${file} keeps its canvas panels visible, bounded, and touch-draggable`, async ({ page }) => {
    await page.route('**/api/room-auth', (route) => route.fulfill({ json: { username: 'mobile-test' } }));
    await page.route('**/api/tenants**', (route) => route.fulfill({ json: { tenants: [] } }));
    await page.route('**/api/board**', (route) => route.fulfill({ status: 503, json: { error: 'test offline' } }));
    await page.goto(`/${file}`);
    await expect(page.locator('.nexus-canvas-panel')).toHaveCount(expectedPanels);
    const visiblePanel = page.locator('.nexus-canvas-panel:visible').first();
    await expect(visiblePanel).toBeVisible();
    const before = await visiblePanel.boundingBox();
    expect(before).not.toBeNull();
    expect(before.x).toBeGreaterThanOrEqual(0);
    expect(before.y).toBeGreaterThanOrEqual(0);
    expect(before.x + before.width).toBeLessThanOrEqual(393);
    expect(before.y + before.height).toBeLessThanOrEqual(852);
    const header = visiblePanel.locator('.nexus-canvas-panel-header');
    await header.evaluate((element) => {
      element.setPointerCapture = () => {};
      element.hasPointerCapture = () => false;
      element.releasePointerCapture = () => {};
      const box = element.getBoundingClientRect();
      const startY = box.top + 20;
      const deltaY = box.top > 30 ? -30 : 30;
      const init = { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: box.left + 20 };
      element.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientY: startY, bubbles: true }));
      element.dispatchEvent(new PointerEvent('pointermove', { ...init, clientY: startY + deltaY, bubbles: true }));
      element.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0, clientY: startY + deltaY, bubbles: true }));
    });
    const after = await visiblePanel.boundingBox();
    expect(Math.abs(after.y - before.y)).toBeGreaterThan(5);
  });
}
