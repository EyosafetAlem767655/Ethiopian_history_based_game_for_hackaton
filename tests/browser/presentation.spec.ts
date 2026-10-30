import { test, expect } from '@playwright/test';
test('renders Amharic branding, articulated isometric play, arrows, zoom and scroll history', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page).toHaveTitle(/ክብረ ጉግስ/);
  await expect
    .poll(() =>
      page.evaluate(() => document.fonts.check('700 28px "Noto Serif Ethiopic"', 'ክብረ ጉግስ')),
    )
    .toBe(true);
  const icon = await page.request.get('/icons/icon-32.png');
  expect(icon.ok()).toBe(true);
  expect(icon.headers()['content-type']).toContain('image/png');
  const apple = await page.request.get('/icons/apple-touch-icon.png');
  expect(apple.ok()).toBe(true);
  expect(apple.headers()['content-type']).toContain('image/png');
  await page.getByRole('button', { name: 'ENTER THE KINGDOM' }).click();
  await page.getByLabel('WARRIOR NAME').fill('Iso Knight');
  await page.getByRole('button', { name: 'PLAY THE STORY DEMO' }).click();
  await page.getByRole('button', { name: 'MY JOURNEY' }).click();
  await page.getByRole('button', { name: 'BEGIN TRIAL', exact: false }).first().click();
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
  await expect(canvas).toHaveAttribute('data-projection', 'isometric');
  await expect(canvas).toHaveAttribute('data-audio', 'running');
  await page.waitForTimeout(2500);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(700);
  const phase = await canvas.getAttribute('data-leg-phase');
  await page.keyboard.up('ArrowRight');
  expect(Number(phase)).not.toBe(0);
  expect(Number(await canvas.getAttribute('data-actor-height'))).toBeGreaterThan(100);
  const box = (await canvas.boundingBox())!;
  expect(box.height).toBeGreaterThan(450);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(200);
  expect(Number(await canvas.getAttribute('data-zoom'))).toBeGreaterThan(1.45);
  await page.screenshot({ path: 'output/playwright/isometric-battle.png' });
  await page.getByRole('button', { name: 'Replay guide animation' }).click();
  await page.getByRole('slider', { name: 'Sound volume' }).fill('0.3');
  expect(await page.evaluate(() => localStorage.getItem('kibre-volume'))).toBe('0.3');
  await page.getByRole('checkbox', { name: 'REDUCED MOTION' }).check();
  await expect(page.locator('.scroll-guide')).toHaveClass(/reduced-motion/);
  // Gameplay shortcuts are deliberately suspended while a form control has focus.
  await canvas.click();
  await page.keyboard.press('f');
  await expect
    .poll(() =>
      page.evaluate(() => document.fullscreenElement?.classList.contains('battle-layout')),
    )
    .toBe(true);
  await page.keyboard.press('f');
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  expect(errors).toEqual([]);
});
