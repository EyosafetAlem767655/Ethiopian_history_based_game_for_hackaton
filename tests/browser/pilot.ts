import { expect, type Page } from '@playwright/test';
import type { World } from '../../packages/shared/src/game';
import { control } from '../controller';
import { campaignControl } from '../campaign-controller';
import { project, screenMovement } from '../../packages/shared/src/presentation';
export async function drive(page: Page, until: (w: World) => boolean = (w) => w.finished) {
  await expect(page.locator('canvas')).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
  const held = new Set<string>();
  let mouse = false;
  let lastPhase = '';
  let lastState: unknown;
  const deadline = Date.now() + 260000;
  try {
    while (Date.now() < deadline) {
      const state = await page.evaluate(async () => {
        const s = window.__kibreInspect!();
        const c = document.querySelector('canvas')!;
        const b = c.getBoundingClientRect();
        return {
          world: s.world,
          id: s.id!,
          canvas: { ...c.dataset },
          box: { x: b.x, y: b.y, width: b.width, height: b.height },
        };
      });
      const w = state.world;
      lastState = w;
      if (!w) {
        await page.waitForTimeout(100);
        continue;
      }
      if (until(w) || w.finished) return w;
      if (lastPhase !== w.mode + ':' + w.phase) {
        lastPhase = w.mode + ':' + w.phase;
        console.log('Browser phase:', lastPhase);
      }
      const p = w.players.find((p) => p.id === state.id);
      if (!p || w.players.length < 2) {
        await page.waitForTimeout(100);
        continue;
      }
      const i = w.campaign ? campaignControl(w, state.id, w.tick) : control(w, state.id, w.tick);
      const { box } = state;
      const wanted = new Set<string>();
      if (Math.hypot(i.x, i.y) > 0.1) {
        let best = -Infinity,
          keys: string[] = [];
        for (const [x, y, k] of [
          [1, 0, ['d']],
          [-1, 0, ['a']],
          [0, 1, ['s']],
          [0, -1, ['w']],
          [1, 1, ['d', 's']],
          [1, -1, ['d', 'w']],
          [-1, 1, ['a', 's']],
          [-1, -1, ['a', 'w']],
        ] as [number, number, string[]][]) {
          const v = screenMovement(x, y),
            dot = v.x * i.x + v.y * i.y;
          if (dot > best) {
            best = dot;
            keys = k;
          }
        }
        keys.forEach((k) => wanted.add(k));
      }
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
      const aim = project(p.x + Math.cos(i.aim) * 120, p.y + Math.sin(i.aim) * 120),
        zoom = Number(state.canvas.zoom);
      await page.mouse.move(
        box.x + (aim.x - Number(state.canvas.scrollX) - box.width / 2) * zoom + box.width / 2,
        box.y + (aim.y - Number(state.canvas.scrollY) - box.height / 2) * zoom + box.height / 2,
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
