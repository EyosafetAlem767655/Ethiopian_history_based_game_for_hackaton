import { expect, test } from '@playwright/test';

test.describe('frontend smoke coverage', () => {
  test('renders the kingdom landing page without browser errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');

    await expect(page).toHaveTitle(/Kibre Gugs|Ethiopian Knights/i);
    await expect(
      page.getByRole('heading', { name: 'A kingdom fallen. A legend rising.' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'ENTER THE KINGDOM' })).toBeEnabled();
    await expect(page.getByText('REAL-TIME COMBAT')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('takes a demo warrior from identity through the campaign screen', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');
    await page.getByRole('button', { name: 'ENTER THE KINGDOM' }).click();
    await page.getByLabel('WARRIOR NAME').fill('Smoke Demo');
    await page.getByRole('button', { name: 'PLAY THE STORY DEMO' }).click();

    await expect(page.getByRole('heading', { name: 'Choose your warrior.' })).toBeVisible();
    await page.getByRole('button', { name: 'MY JOURNEY' }).click();

    await expect(
      page.getByRole('heading', { name: 'The road to the Eclipse Crown.' }),
    ).toBeVisible();
    await expect(page.getByText('STORY DEMO · ~8–12 MIN')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'The Warrior’s Trial' })).toBeVisible();
    await expect(page.getByRole('button', { name: /BEGIN TRAINING/ })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('takes a normal-progress warrior to the arena with training gated', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'ENTER THE KINGDOM' }).click();
    await page.getByLabel('WARRIOR NAME').fill('Smoke Normal');
    await page.getByRole('button', { name: 'BEGIN NORMAL PROGRESSION' }).click();

    await expect(page.getByRole('heading', { name: 'Choose your warrior.' })).toBeVisible();
    await page.getByRole('button', { name: 'MY JOURNEY' }).click();
    await page.getByRole('button', { name: 'Battle arena' }).click();

    await expect(page.getByRole('heading', { name: 'Battle Arena' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ENTER ARENA ⚔' })).toBeDisabled();
    await expect(page.getByText('Complete training above to unlock duels.')).toBeVisible();
    await expect(page.getByText('NORMAL PROGRESSION')).toBeVisible();
  });

  test('keeps the public landing page within a narrow viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await expect(page.getByRole('button', { name: 'ENTER THE KINGDOM' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
});
