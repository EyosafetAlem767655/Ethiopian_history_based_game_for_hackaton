import { Client, type Room } from 'colyseus.js';
const base = process.env.TEST_API ?? 'http://localhost:2567';
const rooms: Room[] = [];
const metrics: { first: number; last: number; count: number }[] = [];
const start = performance.now();
try {
  await Promise.all(
    Array.from({ length: 20 }, async (_, n) => {
      const res = await fetch(base + '/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Load ' + n, demo: true }),
      });
      const s = (await res.json()) as any;
      const r = await new Client(base.replace('http', 'ws')).create('battle', {
        mode: 'tutorial',
        demo: true,
        token: s.token,
      });
      rooms.push(r);
      const m = { first: 0, last: 0, count: 0 };
      metrics.push(m);
      r.onMessage('identity', () => {});
      r.onMessage('result', () => {});
      r.onMessage('snapshot', (w: any) => {
        if (!m.count) m.first = w.tick;
        m.last = w.tick;
        m.count++;
      });
      let seq = 0;
      const interval = setInterval(
        () =>
          r.send('input', {
            seq: seq++,
            x: 0,
            y: 0,
            aim: 0,
            attack: false,
            block: false,
            dodge: false,
            ability: false,
            interact: false,
          }),
        34,
      );
      r.onLeave(() => clearInterval(interval));
    }),
  );
  const active = performance.now();
  await new Promise((r) => setTimeout(r, 15000));
  const elapsed = (performance.now() - active) / 1000;
  const rates = metrics.map((m) => (m.last - m.first) / elapsed);
  console.log(
    JSON.stringify(
      {
        clients: rooms.length,
        rooms: rooms.length,
        seconds: elapsed,
        averageSimulationHz: rates.reduce((a, b) => a + b, 0) / rates.length,
        minSimulationHz: Math.min(...rates),
        snapshots: metrics.reduce((a, m) => a + m.count, 0),
        setupSeconds: (active - start) / 1000,
      },
      null,
      2,
    ),
  );
  if (Math.min(...rates) < 25) throw Error('Simulation below 25 Hz under load');
} finally {
  await Promise.all(rooms.map((r) => r.leave()));
}
