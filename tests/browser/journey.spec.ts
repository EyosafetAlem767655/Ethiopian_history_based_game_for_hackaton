import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { control } from '../controller';
async function drive(page: Page) {
  await expect(page.locator('canvas')).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
  const box = (await page.locator('canvas').boundingBox())!;
  const held = new Set<string>();
  let mouse = false;
  let lastPhase = '';
  let lastState: unknown;
  const deadline = Date.now() + 150000;
  try {
    while (Date.now() < deadline) {
      const state = await page.evaluate(async () => {
        const { useUI } = await import('/src/store.ts');
        const s = useUI.getState();
        return { world: s.snapshot, id: s.session!.profile.id };
      });
      const w = state.world;
      lastState = w;
      if (!w) {
        await page.waitForTimeout(100);
        continue;
      }
      if (w.finished) return w;
      if (lastPhase !== w.mode + ':' + w.phase) {
        lastPhase = w.mode + ':' + w.phase;
        console.log('Browser phase:', lastPhase);
      }
      const p = w.players.find((p) => p.id === state.id);
      if (!p || w.players.length < 2) {
        await page.waitForTimeout(100);
        continue;
      }
      const i = control(w, state.id, w.tick);
      const wanted = new Set<string>();
      if (i.x > 0.2) wanted.add('d');
      if (i.x < -0.2) wanted.add('a');
      if (i.y > 0.2) wanted.add('s');
      if (i.y < -0.2) wanted.add('w');
      if (i.block) wanted.add('MouseRight');
      if (i.interact) wanted.add('e');
      for (const key of ['w', 'a', 's', 'd', 'e']) {
        if (wanted.has(key) && !held.has(key)) {
          await page.keyboard.down(key);
          held.add(key);
        }
        if (!wanted.has(key) && held.has(key)) {
          await page.keyboard.up(key);
          held.delete(key);
        }
      }
      await page.mouse.move(
        box.x + ((p.x + Math.cos(i.aim) * 120) / 1200) * box.width,
        box.y + ((p.y + Math.sin(i.aim) * 120) / 760) * box.height,
      );
      if (i.attack && !mouse) {
        await page.mouse.down();
        mouse = true;
      }
      if (!i.attack && mouse) {
        await page.mouse.up();
        mouse = false;
      }
      if (i.block) await page.mouse.down({ button: 'right' });
      else await page.mouse.up({ button: 'right' });
      if (i.dodge) await page.keyboard.press('Space');
      if (i.ability) await page.keyboard.press('q');
      await page.waitForTimeout(80);
    }
    throw Error('Browser encounter did not finish: ' + JSON.stringify(lastState));
  } finally {
    for (const key of held) await page.keyboard.up(key);
    await page.mouse.up();
    await page.mouse.up({ button: 'right' });
  }
}
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
  await expect(page.getByRole('button', { name: 'ENTER ARENA' })).toBeEnabled();
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
  test.setTimeout(360000);
  await page.goto('/');
  await page.getByRole('button', { name: 'ENTER THE KINGDOM' }).click();
  await page.getByLabel('WARRIOR NAME').fill('Crown Browser');
  await page.getByRole('button', { name: 'PLAY THE STORY DEMO' }).click();
  await page.getByRole('button', { name: 'MY JOURNEY' }).click();
  await page.getByRole('button', { name: 'BEGIN TRAINING' }).click();
  await drive(page);
  await page.getByRole('button', { name: 'CONTINUE THE JOURNEY' }).click();
  await page.getByRole('button', { name: 'ENTER ARENA' }).click();
  expect((await drive(page)).winner).toBe(0);
  await page.getByRole('button', { name: 'CONTINUE THE JOURNEY' }).click();
  await page.getByRole('button', { name: 'FORM A SQUAD' }).click();
  await page.getByRole('button', { name: /READY · BANNER CONQUEST/ }).click();
  expect((await drive(page)).winner).toBe(0);
  await page.getByRole('button', { name: 'CONTINUE THE JOURNEY' }).click();
  await page.getByRole('button', { name: 'FORM A SQUAD' }).click();
  await page.getByRole('button', { name: 'VIEW PASS' }).click();
  await page.getByRole('button', { name: /SIMULATE GATHERING/ }).click();
  await page.getByRole('button', { name: 'ENTER THE CITADEL' }).click();
  const finale = await drive(page);
  expect(finale.phase).toBe('victory');
  await page.screenshot({ path: 'output/playwright/final-victory.png' });
  await page.getByRole('button', { name: 'CONTINUE THE JOURNEY' }).click();
  await page.getByRole('button', { name: 'Your legacy' }).click();
  await expect(page.getByRole('heading', { name: 'Thronebreaker' })).toBeVisible();
  await page.screenshot({ path: 'output/playwright/legacy.png', fullPage: true });
});
