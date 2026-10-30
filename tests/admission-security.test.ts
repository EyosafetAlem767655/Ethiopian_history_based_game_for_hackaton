import { it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'colyseus.js';

it('rejects cross-squad admission, oversized/unauthenticated matchmaking and revoked sessions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'arena-audit-'));
  process.env.DB_PATH = join(directory, 'synthetic.sqlite');
  process.env.SUPABASE_URL = '';
  process.env.SUPABASE_SECRET_KEY = '';
  process.env.SUPABASE_SERVICE_ROLE_KEY = '';
  process.env.SESSION_SECRET = 'synthetic-audit-secret-not-a-real-secret';
  const store = await import('../apps/server/src/store');
  const { eligibility } = await import('../apps/server/src/customization');
  const players = await Promise.all(
    ['A', 'B'].map((name) => store.createProfile('Fixture ' + name, false)),
  );
  for (const [i, p] of players.entries()) {
    p.progress.stage = 3;
    p.progress.tutorial = true;
    await store.saveProfile(p);
    await store.db
      .prepare('INSERT INTO hosted_identities(id,auth_id) VALUES (?,?)')
      .run(p.id, p.id);
    await store.db
      .prepare(
        'INSERT INTO age_reviews(id,player_id,status,birth_date,created,expires) VALUES (?,?,?,?,?,?)',
      )
      .run(p.id, p.id, 'approved', '2000-01-01', Date.now(), Date.now() + 86400000);
    await store.db
      .prepare('INSERT INTO squads(id,code,name,demo,members) VALUES (?,?,?,?,?)')
      .run('team-' + i, 'CODE' + i, 'Fixture team ' + i, 0, JSON.stringify([p.id]));
  }
  const child = spawn(process.execPath, ['--import', 'tsx', 'apps/server/src/index.ts'], {
    env: {
      ...process.env,
      PORT: '2582',
      NODE_ENV: 'test',
      PERSISTENCE: 'sqlite',
      ALLOW_CHAIN_BROADCAST: 'false',
    },
    stdio: 'pipe',
  });
  let errors = '';
  child.stderr?.on('data', (data) => {
    errors += String(data);
  });
  const base = 'http://127.0.0.1:2582';
  const rooms: Awaited<ReturnType<Client['create']>>[] = [];
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        ready = (await fetch(base + '/api/health')).ok;
      } catch {}
      if (ready) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(ready, errors).toBe(true);
    const preflight = await fetch(base + '/matchmake/create/battle', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(preflight.headers.get('access-control-allow-credentials')).toBe('true');
    const client = new Client(base.replace('http:', 'ws:'));
    const band = (await eligibility(players[0].id)).band;
    const options = (actor: number) => ({
      token: store.token(players[actor]),
      protocol: 2,
      demo: false,
      squadId: 'team-' + actor,
      ageBand: band,
    });
    const ownerLobby = await client.create('squad-lobby', options(0));
    rooms.push(ownerLobby);
    await expect(client.joinById(ownerLobby.roomId, options(1))).rejects.toThrow(/another squad/);
    const ownerQuest = await client.create('quest', { ...options(0), mode: 'quest' });
    rooms.push(ownerQuest);
    await expect(
      client.joinById(ownerQuest.roomId, { ...options(1), mode: 'quest' }),
    ).rejects.toThrow(/another squad/);
    const conquest = await client.create('conquest', { ...options(0), mode: 'squad' });
    rooms.push(conquest);
    const duplicate = await Promise.allSettled([
      client.joinById(conquest.roomId, { ...options(1), mode: 'squad' }),
      client.joinById(conquest.roomId, { ...options(1), mode: 'squad' }),
    ]);
    expect(duplicate.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of duplicate) if (result.status === 'fulfilled') rooms.push(result.value);
    const duel = await client.create('battle', { ...options(0), mode: 'duel', squadId: '' });
    const opponent = await client.joinById(duel.roomId, {
      ...options(1),
      mode: 'duel',
      squadId: '',
    });
    rooms.push(duel, opponent);
    // Match chat is for the pre-match countdown; once the fight starts it is dropped.
    const inbox: string[] = [];
    opponent.onMessage('chat', (m: { text: string }) => inbox.push(m.text));
    duel.onMessage('chat', () => {});
    duel.send('chat', 'Good luck before the duel');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(inbox).toEqual(['Good luck before the duel']);
    await new Promise((resolve) => setTimeout(resolve, 5500));
    duel.send('chat', 'Sent during the fight');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(inbox).toEqual(['Good luck before the duel']);
    for (const room of rooms.splice(0)) await room.leave();

    const reserve = (body: unknown = { mode: 'tutorial', demo: false }, origin?: string) =>
      fetch(base + '/matchmake/create/battle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
        body: JSON.stringify(body),
      });
    expect((await reserve({ padding: 'x'.repeat(48 * 1024) })).status).toBe(413);
    expect((await reserve({}, 'https://untrusted.invalid')).status).toBe(403);
    expect((await reserve()).status).toBe(401);
    expect((await reserve({ token: store.token(players[0]) + '.ignored' })).status).toBe(401);
    const credential = store.token(players[0]);
    const live = await client.create('battle', {
      ...options(0),
      token: credential,
      mode: 'tutorial',
    });
    rooms.push(live);
    const left = new Promise<number>((resolve) => live.onLeave(resolve));
    const logout = await fetch(base + '/api/session/logout', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + credential },
    });
    expect(logout.status).toBe(200);
    expect(await left).toBe(4001);
    expect(
      (await fetch(base + '/api/me', { headers: { Authorization: 'Bearer ' + credential } }))
        .status,
    ).toBe(401);
    expect((await reserve({ token: credential })).status).toBe(401);
    let lastStatus = 0;
    for (let i = 0; i < 121; i++) lastStatus = (await reserve()).status;
    expect(lastStatus).toBe(429);
  } finally {
    for (const room of rooms) if (room.connection.isOpen) await room.leave().catch(() => {});
    child.kill();
    if (child.exitCode === null) await new Promise<void>((r) => child.once('exit', () => r()));
    await store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
