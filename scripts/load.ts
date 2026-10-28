import { Client, type Room } from 'colyseus.js';
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { World, Input } from '../packages/shared/src/game';
const base = process.env.TEST_API ?? 'http://localhost:2567',
  web = process.env.TEST_WEB ?? 'http://localhost:5173';
const rooms: Room[] = [],
  timers: ReturnType<typeof setInterval>[] = [],
  worlds: World[] = [];
let monsterSnapshots = 0,
  projectileSnapshots = 0,
  totalBytes = 0,
  snapshots = 0;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await Promise.all(
    Array.from({ length: 19 }, async (_, n) => {
      const res = await fetch(base + '/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Load ' + n, demo: true }),
      });
      if (!res.ok) throw Error('Load session failed');
      const s = (await res.json()) as any;
      const r = await new Client(base.replace(/^http/, 'ws')).create('campaign', {
        protocol: 2,
        missionId: 1,
        demo: true,
        token: s.token,
        hero: 0,
      });
      rooms.push(r);
      r.onMessage('identity', () => {});
      r.onMessage('waiting', () => {});
      r.onMessage('result', () => {});
      r.onMessage('snapshot', (w: World) => {
        worlds[n] = w;
        snapshots++;
        totalBytes += JSON.stringify(w).length;
        if (w.players.some((p) => p.team === 1 && p.kind)) monsterSnapshots++;
        if (w.projectiles.length) projectileSnapshots++;
      });
      let seq = 0;
      timers.push(
        setInterval(() => {
          const w = worlds[n],
            p = w?.players.find((p) => p.id === s.profile.id);
          if (!w || !p || w.finished) return;
          const enemy = w.players
            .filter((q) => q.team !== p.team && q.hp > 0)
            .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
          const dx = (enemy?.x ?? 600) - p.x,
            dy = (enemy?.y ?? 380) - p.y,
            d = Math.hypot(dx, dy) || 1;
          let x = d > 80 ? dx / d : 0,
            y = d > 80 ? dy / d : 0;
          const obstacle = w.geometry!.obstacles.find(
            (o) => p.x > o.x - 45 && p.x < o.x + o.w + 45 && p.y > o.y - 45 && p.y < o.y + o.h + 45,
          );
          if (obstacle) {
            x = p.x < obstacle.x + obstacle.w / 2 ? -1 : 1;
            y = p.y < obstacle.y + obstacle.h / 2 ? -1 : 1;
          }
          const i: Input = {
            seq: seq++,
            x,
            y,
            aim: Math.atan2(dy, dx),
            attack: !!enemy && d < 150,
            block: p.hp < 30,
            dodge: w.tick % 90 === 0,
            ability: w.tick % 150 === 0,
            interact: true,
          };
          r.send('input', i);
        }, 34),
      );
    }),
  );
  await page.goto(web);
  await page.getByRole('button', { name: 'ENTER THE KINGDOM' }).click();
  await page.getByLabel('WARRIOR NAME').fill('Rendering probe');
  await page.getByRole('button', { name: 'PLAY THE STORY DEMO' }).click();
  await page.getByRole('button', { name: 'MY JOURNEY' }).click();
  await page
    .getByRole('button', { name: /BEGIN TRIAL/ })
    .first()
    .click();
  await page.locator('canvas[data-ready="true"]').waitFor();
  await page.waitForTimeout(3500);
  const probe = () =>
    page.evaluate(() => {
      const s = window.__kibreInspect!(),
        c = document.querySelector('canvas')!;
      return { world: s.world, fps: Number(c.dataset.fps), renderer: c.dataset.renderer };
    });
  const before = worlds.map((w) => w.tick),
    first = await probe(),
    start = performance.now(),
    fps: number[] = [];
  let maxActors = 0,
    last = first;
  while (performance.now() - start < 30000) {
    last = await probe();
    if (last.fps > 0) fps.push(last.fps);
    maxActors = Math.max(maxActors, ...worlds.map((w) => w.players.length));
    await new Promise((r) => setTimeout(r, 100));
  }
  const seconds = (performance.now() - start) / 1000,
    rates = worlds.map((w, n) => (w.tick - before[n]) / seconds);
  rates.push(((last.world?.tick ?? 0) - (first.world?.tick ?? 0)) / seconds);
  fps.sort((a, b) => a - b);
  const report = {
    humanClients: 20,
    nodeClients: 19,
    renderedBrowserClients: 1,
    activeRooms: 20,
    mode: 'campaign Shield Oath with combat, AI allies, monsters and swept magic projectiles',
    seconds,
    averageSimulationHz: rates.reduce((a, b) => a + b, 0) / 20,
    minSimulationHz: Math.min(...rates),
    maxActorsPerRoom: maxActors,
    snapshots,
    monsterSnapshots,
    projectileSnapshots,
    receivedBytes: totalBytes,
    rendering: {
      browser: 'headless Chromium',
      renderer: last.renderer,
      viewport: '1440x1000',
      samples: fps.length,
      medianFPS: fps[Math.floor(fps.length * 0.5)],
      p10FPS: fps[Math.floor(fps.length * 0.1)],
    },
  };
  mkdirSync('output', { recursive: true });
  writeFileSync('output/load-expanded.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.minSimulationHz < 25) throw Error('Simulation below 25 Hz under load');
  if (!projectileSnapshots || !monsterSnapshots)
    throw Error('Load did not exercise monsters and projectiles');
} finally {
  for (const t of timers) clearInterval(t);
  await Promise.allSettled(rooms.map((r) => r.leave()));
  await browser.close();
}
