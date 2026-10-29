import { persistence } from './database';
import { createClient } from '@supabase/supabase-js';
import {
  db,
  profile,
  saveProfile,
  token,
  digest,
  issueBadge,
  campaignProgress,
  saveCampaign,
  type Profile,
} from './store';
import { freshProgress } from '../../../packages/shared/src/game';
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import express from 'express';
const url = process.env.SUPABASE_URL,
  key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
export const supabase =
  url && key
    ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
await db.exec(`CREATE TABLE IF NOT EXISTS hosted_identities(id TEXT PRIMARY KEY,auth_id TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS hosted_outbox(match_id TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'pending',error TEXT);
CREATE TABLE IF NOT EXISTS gathering_sessions(id TEXT PRIMARY KEY,squad_id TEXT NOT NULL,path TEXT,approvals TEXT NOT NULL DEFAULT '[]',verified INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL DEFAULT 0);`);
if (persistence === 'sqlite') {
  const columns = await db.prepare('PRAGMA table_info(hosted_identities)').all();
  if (!columns.some((c) => c.name === 'auth_id'))
    await db.exec(
      'ALTER TABLE hosted_identities ADD COLUMN auth_id TEXT; CREATE UNIQUE INDEX IF NOT EXISTS hosted_auth ON hosted_identities(auth_id);',
    );
  const gatheringColumns = await db.prepare('PRAGMA table_info(gathering_sessions)').all();
  if (!gatheringColumns.some((c) => c.name === 'created'))
    await db.exec('ALTER TABLE gathering_sessions ADD COLUMN created INTEGER NOT NULL DEFAULT 0;');
}
export async function isHosted(id: string) {
  return !!(await db.prepare('SELECT id FROM hosted_identities WHERE id=?').get(id));
}
export async function exchangeHosted(accessToken: string, name: string) {
  if (!supabase) throw Error('Supabase is not configured');
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) throw Error('Invalid Supabase session');
  const link = await db
    .prepare('SELECT id FROM hosted_identities WHERE auth_id=? OR id=?')
    .get(data.user.id, data.user.id);
  const id = link?.id ?? data.user.id;
  let p = await profile(id);
  if (!p) {
    const remote = await supabase
      .from('player_progression')
      .select('progress')
      .eq('player_id', id)
      .maybeSingle();
    if (remote.error) throw remote.error;
    await db
      .prepare('INSERT INTO profiles(id,name,demo,hero,progress) VALUES (?,?,?,?,?)')
      .run(id, name, 0, 0, JSON.stringify(remote.data?.progress ?? freshProgress()));
    p = (await profile(id))!;
    const campaign = await supabase
      .from('campaign_progress')
      .select('data')
      .eq('player_id', id)
      .maybeSingle();
    if (campaign.data?.data) await saveCampaign(id, campaign.data.data);
  }
  await db
    .prepare(
      'INSERT INTO hosted_identities(id,auth_id) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET auth_id=excluded.auth_id',
    )
    .run(id, data.user.id);
  const up = await supabase.from('profiles').upsert({ id, nickname: p.name, hero: p.hero });
  if (up.error) throw up.error;
  return { token: token(p), profile: p, identity: 'supabase' };
}
// Supabase runtime is the authority, not an eventually consistent mirror.
export async function syncHosted() {}
export async function approveGathering(sessionId: string, playerId: string, consent: boolean) {
  return db.transaction(async () => {
    const s = await db.prepare('SELECT * FROM gathering_sessions WHERE id=?').get(sessionId);
    if (!s?.path || !consent)
      throw Error('Review the uploaded image and explicitly approve participation');
    const squad = await db.prepare('SELECT * FROM squads WHERE id=? AND demo=0').get(s.squad_id);
    const members: string[] = squad ? JSON.parse(squad.members) : [];
    if (members.length !== 4 || !members.includes(playerId))
      throw Error('Four authenticated squad members required');
    await (await import('./customization')).assertParty(members);
    for (const id of members) {
      const p = await profile(id),
        campaign = await campaignProgress(id);
      if (
        !p ||
        (!campaign.completed.includes(10) &&
          (p.progress.squadWins < 2 || p.progress.squadRating < 1100))
      )
        throw Error('Squad qualification not met');
    }
    const approvals = [
      ...new Set<string>([
        ...JSON.parse(s.approvals).filter((id: string) => members.includes(id)),
        playerId,
      ]),
    ];
    const verified = members.every((id) => approvals.includes(id));
    const hash = digest({
      sessionId: s.id,
      squadId: s.squad_id,
      approvals: approvals.map((id) => digest(id)).sort(),
      simulated: false,
    });
    await db
      .prepare('UPDATE gathering_sessions SET approvals=?,verified=? WHERE id=?')
      .run(JSON.stringify(approvals), Number(verified), s.id);
    if (verified)
      for (const id of members) {
        const p = (await profile(id))!;
        p.progress.stage = 3;
        await saveProfile(p);
        const campaign = await campaignProgress(id);
        campaign.fellowship = true;
        await saveCampaign(id, campaign);
        await issueBadge(id, 'Proof of Fellowship', s.id);
      }
    return { approvals, verified, hash };
  })();
}
export function registerHostedRoutes(app: Express) {
  app.get('/api/gathering-squad/:id', async (q, r) => {
    const squad = (await db
      .prepare('SELECT members FROM squads WHERE id=?')
      .get(q.params.id)) as any;
    if (!squad || !JSON.parse(squad.members).includes(r.locals.player.id)) {
      r.status(403).json({ error: 'Squad membership required' });
      return;
    }
    const s = (await db
      .prepare(
        'SELECT id FROM gathering_sessions WHERE squad_id=? ORDER BY created DESC,id DESC LIMIT 1',
      )
      .get(q.params.id)) as any;
    r.json({ id: s?.id ?? null });
  });
  app.post('/api/gathering', async (q, r) => {
    try {
      const p = r.locals.player;
      if (!supabase || p.demo || !(await isHosted(p.id)))
        throw Error('Four Supabase-authenticated humans are required');
      const squad = (await db
        .prepare('SELECT * FROM squads WHERE id=?')
        .get(q.body.squadId)) as any;
      if (!squad) throw Error('Unknown squad');
      const members = JSON.parse(squad.members) as string[];
      await (await import('./customization')).assertParty(members);
      if (
        members.length !== 4 ||
        !members.includes(p.id) ||
        (await Promise.all(members.map((id) => isHosted(id)))).some((v) => !v)
      )
        throw Error('Four authenticated squad members required');
      if (members[0] !== p.id) throw Error('Only the squad leader can create a gathering');
      if (
        (
          await Promise.all(
            members.map(async (id) => {
              const pr = (await profile(id))!.progress;
              return (
                !(await campaignProgress(id)).completed.includes(10) &&
                (pr.squadWins < 2 || pr.squadRating < 1100)
              );
            }),
          )
        ).some(Boolean)
      )
        throw Error('Squad qualification not met');
      const id = randomUUID();
      await db
        .prepare('INSERT INTO gathering_sessions(id,squad_id,created) VALUES (?,?,?)')
        .run(id, squad.id, Date.now());
      r.json({ id, approvals: [], verified: false });
    } catch (e) {
      r.status(403).json({ error: (e as Error).message });
    }
  });
  async function session(id: string, playerId: string) {
    const s = (await db.prepare('SELECT * FROM gathering_sessions WHERE id=?').get(id)) as any;
    if (!s) throw Error('Unknown gathering');
    const squad = (await db.prepare('SELECT * FROM squads WHERE id=?').get(s.squad_id)) as any;
    const members = JSON.parse(squad.members) as string[];
    await (await import('./customization')).assertParty(members);
    if (!members.includes(playerId) || !(await isHosted(playerId)))
      throw Error('Authenticated squad membership required');
    return { s, squad, members };
  }
  app.get('/api/gathering/:id', async (q, r) => {
    try {
      const { s } = await session(q.params.id, r.locals.player.id);
      let photoUrl = null;
      if (s.path && supabase) {
        const out = await supabase.storage.from('gatherings').createSignedUrl(s.path, 60);
        photoUrl = out.data?.signedUrl;
      }
      r.json({ id: s.id, approvals: JSON.parse(s.approvals), verified: !!s.verified, photoUrl });
    } catch (e) {
      r.status(403).json({ error: (e as Error).message });
    }
  });
  app.post(
    '/api/gathering/:id/photo',
    express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: '5mb' }),
    async (q, r) => {
      try {
        const p = r.locals.player,
          { s } = await session(q.params.id, p.id);
        if (!supabase || q.headers['x-photo-consent'] !== 'true')
          throw Error('Explicit photo consent required');
        if (s.verified) throw Error('Gathering already verified');
        const bytes = q.body as Buffer;
        if (!Buffer.isBuffer(bytes) || bytes.length < 12) throw Error('Invalid image');
        const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
          jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
          webp =
            bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
        const mime = png ? 'image/png' : jpeg ? 'image/jpeg' : webp ? 'image/webp' : '';
        if (!mime || mime !== q.headers['content-type']) throw Error('Unsupported image signature');
        const path = s.id + '/' + randomUUID();
        const out = await supabase.storage
          .from('gatherings')
          .upload(path, bytes, { contentType: mime });
        if (out.error) throw out.error;
        if (s.path) await supabase.storage.from('gatherings').remove([s.path]);
        await db
          .prepare('UPDATE gathering_sessions SET path=?,approvals=? WHERE id=?')
          .run(path, JSON.stringify([p.id]), s.id);
        r.json({ uploaded: true });
      } catch (e) {
        r.status(400).json({ error: (e as Error).message });
      }
    },
  );
  app.post('/api/gathering/:id/approve', async (q, r) => {
    try {
      const { s, members, squad } = await session(q.params.id, r.locals.player.id);
      if (!s.path || q.body.consent !== true)
        throw Error('Review the uploaded image and explicitly approve participation');
      const approvals = [...new Set<string>([...JSON.parse(s.approvals), r.locals.player.id])];
      const verified = members.every((id) => approvals.includes(id));
      const hash = digest({
        sessionId: s.id,
        squadId: s.squad_id,
        approvals: approvals.map((id) => digest(id)).sort(),
        simulated: false,
      });
      await db.transaction(async () => {
        await db
          .prepare('UPDATE gathering_sessions SET approvals=?,verified=? WHERE id=?')
          .run(JSON.stringify(approvals), Number(verified), s.id);
        if (verified) {
          for (const id of members) {
            const p = (await profile(id))!;
            p.progress.stage = 3;
            await saveProfile(p);
            const campaign = await campaignProgress(id);
            campaign.fellowship = true;
            await saveCampaign(id, campaign);
            await issueBadge(id, 'Proof of Fellowship', s.id);
          }
        }
      })();
      r.json({ approvals, verified, hash });
    } catch (e) {
      r.status(400).json({ error: (e as Error).message });
    }
  });
  app.delete('/api/gathering/:id/photo', async (q, r) => {
    try {
      const { s } = await session(q.params.id, r.locals.player.id);
      if (s.path && supabase) {
        const out = await supabase.storage.from('gatherings').remove([s.path]);
        if (out.error) throw out.error;
      }
      await db.prepare('UPDATE gathering_sessions SET path=NULL WHERE id=?').run(s.id);
      r.json({ deleted: true });
    } catch (e) {
      r.status(403).json({ error: (e as Error).message });
    }
  });
}
