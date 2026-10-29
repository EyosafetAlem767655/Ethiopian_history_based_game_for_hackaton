import { expect, it } from 'vitest';
import {
  avatarSchema,
  defaultAvatar,
  birthISO,
  ageBand,
  gaitFoot,
  joint,
} from '../packages/shared/src/customization';
process.env.DB_PATH = ':memory:';
const store = await import('../apps/server/src/store');
const custom = await import('../apps/server/src/customization');
it('validates bounded cosmetic settings and rejects arbitrary photos/unknown fields', () => {
  expect(avatarSchema.parse(defaultAvatar)).toEqual(defaultAvatar);
  expect(avatarSchema.safeParse({ ...defaultAvatar, selfie: 'data:photo' }).success).toBe(false);
  expect(avatarSchema.safeParse({ ...defaultAvatar, skin: 'url' }).success).toBe(false);
});
it('defaults to the painted hero head, including avatars saved before the face option', () => {
  expect(defaultAvatar.face).toBe('hero');
  const { face: _face, ...legacy } = defaultAvatar;
  expect(avatarSchema.parse({ ...legacy, hair: 'braids' })).toEqual({
    ...defaultAvatar,
    hair: 'braids',
  });
  expect(avatarSchema.parse({ ...defaultAvatar, face: 'custom' }).face).toBe('custom');
  expect(avatarSchema.safeParse({ ...defaultAvatar, face: 'selfie' }).success).toBe(false);
});
it('converts Ethiopian dates and rejects constrained/partial dates', () => {
  expect(birthISO({ year: 2016, month: 1, day: 1, calendar: 'ethiopian' })).toBe('2023-09-12');
  expect(birthISO({ year: 2015, month: 13, day: 6, calendar: 'ethiopian' })).toBe('2023-09-11');
  expect(() => birthISO({ year: 2016, month: 13, day: 6, calendar: 'ethiopian' })).toThrow();
  expect(() => birthISO({ year: 2000, month: 2, day: 30, calendar: 'gregorian' })).toThrow();
  expect(() => birthISO({ year: 2000 } as any)).toThrow();
});
it('uses full birthdays and Addis Ababa dates for adult eligibility and band boundaries', () => {
  const now = new Date('2026-10-29T10:00:00Z');
  expect(ageBand('2008-10-30', now)).toBeNull();
  expect(ageBand('2008-10-29', now)).toBe('18–24');
  expect(ageBand('2001-10-29', now)).toBe('25–34');
  expect(ageBand('1991-10-29', now)).toBe('35–44');
  expect(ageBand('1981-10-29', now)).toBe('45+');
  expect(ageBand('2008-10-30', new Date('2026-10-29T21:00:00Z'))).toBe('18–24');
  expect(ageBand('2000-02-31', now)).toBeNull();
});
it('plants feet during stance, lifts knees higher and preserves joint lengths', () => {
  expect(gaitFoot(Math.PI * 0.3).y).toBe(0);
  expect(gaitFoot(Math.PI * 1.6).y).toBeCloseTo(-16);
  const hip = { x: 0, y: -34 },
    foot = { x: 12, y: 1 },
    k = joint(hip, foot, 23, 23, -1);
  expect(Math.hypot(k.x - hip.x, k.y - hip.y)).toBeCloseTo(23);
  expect(Math.hypot(foot.x - k.x, foot.y - k.y)).toBeCloseTo(23);
});
it('keeps age data private, rejects unreviewed/expired accounts and enforces matching bands', async () => {
  const a = await store.createProfile('Adult A', false),
    b = await store.createProfile('Adult B', false);
  await expect(custom.assertHumanBand(a.id, '18–24')).rejects.toThrow('reviewed');
  for (const p of [a, b])
    await store.db.prepare('INSERT INTO hosted_identities(id) VALUES (?)').run(p.id);
  await store.db
    .prepare(
      'INSERT INTO age_reviews(id,player_id,status,birth_date,created,expires) VALUES (?,?,?,?,?,?)',
    )
    .run('a', a.id, 'approved', '2005-05-01', Date.now(), Date.now() + 10000);
  await store.db
    .prepare(
      'INSERT INTO age_reviews(id,player_id,status,birth_date,created,expires) VALUES (?,?,?,?,?,?)',
    )
    .run('b', b.id, 'approved', '1997-05-01', Date.now(), Date.now() + 10000);
  expect((await custom.eligibility(a.id)).band).toBe('18–24');
  await expect(custom.assertParty([a.id, b.id])).rejects.toThrow('same age band');
  expect(JSON.stringify(await store.profile(a.id))).not.toContain('2005-05-01');
  await store.db.prepare("UPDATE age_reviews SET status='pending',expires=0 WHERE id='a'").run();
  expect((await custom.eligibility(a.id)).status).toBe('expired');
  expect((await custom.eligibility(a.id)).band).toBeNull();
});
it('serializes concurrent results without losing wins or repeating first-clear rewards', async () => {
  const { world, fighter } = await import('../packages/shared/src/game');
  const p = await store.createProfile('Concurrent', true),
    w = world('duel', true);
  w.players = [fighter(p.id, p.name)];
  w.finished = true;
  w.winner = 0;
  const started = new Date().toISOString();
  const out = await Promise.all([
    store.recordResult('concurrent-1', w, started),
    store.recordResult('concurrent-1', w, started),
    store.recordResult('concurrent-2', w, started),
  ]);
  expect(out.filter(Boolean)).toHaveLength(2);
  expect((await store.profile(p.id))!.progress.wins).toBe(2);
});
it('preserves four concurrent gathering approvals and awards fellowship once', async () => {
  const { randomUUID } = await import('node:crypto');
  const { approveGathering } = await import('../apps/server/src/hosted');
  const members = [];
  for (let n = 0; n < 4; n++) {
    const p = await store.createProfile('Gathering ' + n, false);
    p.progress.squadWins = 2;
    p.progress.squadRating = 1100;
    await store.saveProfile(p);
    members.push(p.id);
    await store.db.prepare('INSERT INTO hosted_identities(id) VALUES (?)').run(p.id);
    await store.db
      .prepare(
        'INSERT INTO age_reviews(id,player_id,status,birth_date,created,expires) VALUES (?,?,?,?,?,?)',
      )
      .run(randomUUID(), p.id, 'approved', '2003-05-01', Date.now(), Date.now() + 10000);
  }
  const id = randomUUID();
  await store.db
    .prepare('INSERT INTO squads(id,code,name,demo,members) VALUES (?,?,?,?,?)')
    .run(id, id.slice(0, 6), 'Concurrent fellowship', 0, JSON.stringify(members));
  await store.db
    .prepare('INSERT INTO gathering_sessions(id,squad_id,path) VALUES (?,?,?)')
    .run(id, id, 'synthetic-private-evidence');
  const results = await Promise.all(members.map((p) => approveGathering(id, p, true)));
  expect(results.at(-1)?.verified).toBe(true);
  expect(results.at(-1)?.approvals).toHaveLength(4);
  await approveGathering(id, members[0], true);
  for (const p of members) {
    expect((await store.campaignProgress(p)).fellowship).toBe(true);
    expect(
      (await store.badges(p)).filter((b: any) => b.badge === 'Proof of Fellowship'),
    ).toHaveLength(1);
  }
});
