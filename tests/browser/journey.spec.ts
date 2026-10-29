import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { drive } from './pilot';
import { MISSIONS, DEMO_MISSIONS } from '../../packages/shared/src/missions';
test('new warrior selects a hero, learns combat and receives a persisted training result', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'A kingdom fallen. A legend rising.' }),
  ).toBeVisible();
  await page.screenshot({ path: 'output/playwright/kingdom.png', fullPage: true });
  await page.getByRole('button', { name: 'ENTER THE KINGDOM' }).click();
  await page.getByLabel('WARRIOR NAME').fill('Browser Knight');
  await page.getByRole('button', { name: 'PLAY THE STORY DEMO' }).click();
  await expect(page.getByRole('heading', { name: 'Choose your warrior.' })).toBeVisible();
  await page.getByRole('button', { name: /The Highland Spear/ }).click();
  await page.getByRole('button', { name: 'MY JOURNEY' }).click();
  await page.getByRole('button', { name: 'BEGIN TRAINING' }).click();
  await expect(page.locator('canvas')).toBeVisible();
  // Use real controls with authoritative position feedback instead of fixed movement sleeps.
  await drive(page);
  await expect(page.getByRole('heading', { name: 'A warrior awakens.' })).toBeVisible();
  await page.screenshot({ path: 'output/playwright/training-result.png' });
  await page.getByRole('button', { name: 'CONTINUE THE JOURNEY' }).click();
  await expect(
    page.getByRole('button', { name: 'BEGIN TRIAL', exact: false }).first(),
  ).toBeEnabled();
  expect(errors).toEqual([]);
});
test('menus remain usable at a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'ENTER THE KINGDOM' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'output/playwright/mobile.png', fullPage: true });
});
test('a solo judge completes every chapter through browser controls', async ({ page }) => {
  test.setTimeout(900000);
  await page.goto('/');
  await page.getByRole('button', { name: 'ENTER THE KINGDOM' }).click();
  await page.getByLabel('WARRIOR NAME').fill('Crown Browser');
  await page.getByRole('button', { name: 'PLAY THE STORY DEMO' }).click();
  await page.getByRole('button', { name: 'MY JOURNEY' }).click();
  await page.getByRole('button', { name: 'BEGIN TRAINING' }).click();
  await drive(page);
  await page.getByRole('button', { name: 'CONTINUE THE JOURNEY' }).click();
  for (const id of DEMO_MISSIONS) {
    if (id === 12) {
      await page.getByRole('button', { name: /OPEN THE LUNCH PASS/ }).click();
      await page.getByRole('button', { name: /VIEW PASS/ }).click();
      await page.getByRole('button', { name: /SIMULATE GATHERING/ }).click();
    }
    let result;
    for (let attempt = 0; attempt < 3; attempt++) {
      await page
        .getByRole('heading', { name: MISSIONS[id - 1].name, exact: true })
        .locator('..')
        .getByRole('button', { name: /BEGIN TRIAL/ })
        .click();
      result = await drive(page);
      if (result.winner === 0) break;
      await page.getByRole('button', { name: 'CONTINUE THE JOURNEY' }).click();
    }
    if (!result) throw Error('No mission result');
    expect(result.winner, `Mission ${id}`).toBe(0);
    if (id === 15) {
      expect(result.phase).toBe('victory');
      await page.screenshot({ path: 'output/playwright/final-victory.png' });
    }
    await page.getByRole('button', { name: 'CONTINUE THE JOURNEY' }).click();
    await expect(
      page
        .getByRole('heading', { name: MISSIONS[id - 1].name, exact: true })
        .locator('..')
        .getByRole('button', { name: /REPLAY TRIAL/ }),
    ).toBeEnabled();
    if (id === 2) {
      await page.reload();
      await page.getByRole('button', { name: 'Your journey', exact: false }).first().click();
      await expect(
        page
          .getByRole('heading', { name: MISSIONS[1].name, exact: true })
          .locator('..')
          .getByRole('button', { name: /REPLAY TRIAL/ }),
      ).toBeEnabled();
    }
  }
  await page.getByRole('button', { name: 'Your legacy' }).click();
  await expect(page.getByRole('heading', { name: 'Thronebreaker' })).toBeVisible();
  await page.screenshot({ path: 'output/playwright/legacy.png', fullPage: true });
});
