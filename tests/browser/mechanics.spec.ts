import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { drive } from './pilot';
import { MISSIONS } from '../../packages/shared/src/missions';
import type { World } from '../../packages/shared/src/game';
const goals: Record<number, (w: World) => boolean> = {
  1: (w) =>
    w.players.some((p) => p.kind === 'civilian') && w.players.some((p) => !p.bot && p.damage > 0),
  2: (w) => w.campaign!.markers.some((a) => a.done),
  3: (w) => w.campaign!.clues > 0,
  4: (w) => w.players.some((p) => !p.bot && p.damage > 0),
  5: (w) =>
    w.players.some((p) => !p.bot && p.damage > 0) && (w.campaign!.markers[0].value ?? 0) > 0,
  6: (w) => w.zones.some((z) => z.owner === 0),
  7: (w) => w.campaign!.escort > 0,
  8: (w) => w.campaign!.markers.some((a) => a.kind === 'captive' && a.done),
  9: (w) => !!w.campaign!.carrier,
  10: (w) => w.campaign!.clues > 0,
  11: (w) => w.campaign!.markers.some((a) => a.done),
  12: (w) => w.campaign!.entered.length > 0,
  13: (w) => w.campaign!.markers.some((a) => (a.value ?? 0) > 0),
  14: (w) => w.events.some((e) => e.kind === 'danger'),
  15: (w) => w.phase === 'eclipse' && w.campaign!.markers.some((a) => a.done),
};
for (const m of MISSIONS)
  test(`mission mechanic ${m.id}: ${m.name}`, async ({ page }) => {
    test.setTimeout(150000);
    const fixtures = JSON.parse(readFileSync('output/tests/browser-fixtures.json', 'utf8'));
    // Only the dedicated in-memory test backend seeds prior checkpoints. No completion is injected.
    await page.addInitScript(
      (s) => localStorage.setItem('knights-session', JSON.stringify(s)),
      fixtures[m.id],
    );
    await page.goto('/');
    await page.getByRole('button', { name: 'Your journey', exact: false }).first().click();
    await page
      .getByRole('heading', { name: m.name, exact: true })
      .locator('..')
      .getByRole('button', { name: /BEGIN TRIAL/ })
      .click();
    const w = await drive(page, goals[m.id]);
    expect(
      goals[m.id](w),
      JSON.stringify({ phase: w.phase, objective: w.campaign!.objective }),
    ).toBe(true);
  });
