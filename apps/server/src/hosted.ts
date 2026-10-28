import { createClient } from '@supabase/supabase-js';
import { db, profile, saveProfile, token, digest, issueBadge, type Profile } from './store';
import { freshProgress } from '../../../packages/shared/src/game';
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import express from 'express';
const url = process.env.SUPABASE_URL,
  key = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const supabase =
  url && key
    ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
db.exec(`CREATE TABLE IF NOT EXISTS hosted_identities(id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS hosted_outbox(match_id TEXT PRIMARY KEY,status TEXT NOT NULL DEFAULT 'pending',error TEXT);
CREATE TABLE IF NOT EXISTS gathering_sessions(id TEXT PRIMARY KEY,squad_id TEXT NOT NULL,path TEXT,approvals TEXT NOT NULL DEFAULT '[]',verified INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS wallets(player_id TEXT PRIMARY KEY,address TEXT UNIQUE NOT NULL);
CREATE TABLE IF NOT EXISTS wallet_nonces(player_id TEXT PRIMARY KEY,nonce TEXT NOT NULL,expires INTEGER NOT NULL);`);
export function isHosted(id: string) {
  return !!db.prepare('SELECT id FROM hosted_identities WHERE id=?').get(id);
}
export async function exchangeHosted(accessToken: string, name: string) {
  if (!supabase) throw Error('Supabase is not configured');
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) throw Error('Invalid Supabase session');
  const id = data.user.id;
  let p = profile(id);
  if (!p) {
    const remote = await supabase
      .from('player_progression')
      .select('progress')
      .eq('player_id', id)
      .maybeSingle();
    if (remote.error) throw remote.error;
    db.prepare('INSERT INTO profiles VALUES (?,?,?,?,?)').run(
      id,
      name,
      0,
      0,
      JSON.stringify(remote.data?.progress ?? freshProgress()),
    );
    p = profile(id)!;
  }
  db.prepare('INSERT OR IGNORE INTO hosted_identities VALUES (?)').run(id);
  const up = await supabase.from('profiles').upsert({ id, nickname: p.name, hero: p.hero });
  if (up.error) throw up.error;
  return { token: token(p), profile: p, identity: 'supabase' };
}
let syncing = false;
export async function syncHosted() {
  if (!supabase || syncing) return;
  syncing = true;
  try {
    db.prepare(
      `INSERT OR IGNORE INTO hosted_outbox(match_id) SELECT DISTINCT p.match_id FROM participants p JOIN hosted_identities h ON h.id=p.player_id JOIN results r ON r.id=p.match_id WHERE r.demo=0`,
    ).run();
    const pending = db
      .prepare(
        `SELECT r.*,o.status chain_status FROM hosted_outbox h JOIN results r ON r.id=h.match_id JOIN outbox o ON o.match_id=r.id WHERE h.status='pending' ORDER BY r.created`,
      )
      .all() as any[];
    for (const row of pending) {
      const payload = JSON.parse(row.payload),
        players = payload.participants
          .filter((p: any) => isHosted(p.id))
          .map((p: any) => ({ ...profile(p.id), stats: p })),
        badges = (
          db.prepare('SELECT * FROM badges WHERE match_id=?').all(row.id) as { player_id: string }[]
        ).filter((b) => isHosted(b.player_id));
      const { error } = await supabase.rpc('commit_match', {
        p_id: row.id,
        p_payload: payload,
        p_hash: row.hash,
        p_players: players,
        p_badges: badges,
        p_status: row.chain_status,
      });
      if (error) {
        db.prepare('UPDATE hosted_outbox SET error=? WHERE match_id=?').run(error.message, row.id);
      } else
        db.prepare('UPDATE hosted_outbox SET status=?,error=NULL WHERE match_id=?').run(
          'confirmed',
          row.id,
        );
    }
  } finally {
    syncing = false;
  }
}
export function registerHostedRoutes(app: Express) {
  app.get('/api/gathering-squad/:id', (q, r) => {
    const squad = db.prepare('SELECT members FROM squads WHERE id=?').get(q.params.id) as any;
    if (!squad || !JSON.parse(squad.members).includes(r.locals.player.id)) {
      r.status(403).json({ error: 'Squad membership required' });
      return;
    }
    const s = db
      .prepare('SELECT id FROM gathering_sessions WHERE squad_id=? ORDER BY rowid DESC LIMIT 1')
      .get(q.params.id) as any;
    r.json({ id: s?.id ?? null });
  });
  app.post('/api/gathering', (q, r) => {
    try {
      const p = r.locals.player;
      if (!supabase || p.demo || !isHosted(p.id))
        throw Error('Four Supabase-authenticated humans are required');
      const squad = db.prepare('SELECT * FROM squads WHERE id=?').get(q.body.squadId) as any;
      if (!squad) throw Error('Unknown squad');
      const members = JSON.parse(squad.members) as string[];
      if (members.length !== 4 || !members.includes(p.id) || members.some((id) => !isHosted(id)))
        throw Error('Four authenticated squad members required');
      if (members[0] !== p.id) throw Error('Only the squad leader can create a gathering');
      if (
        members.some((id) => {
          const pr = profile(id)!.progress;
          return pr.squadWins < 2 || pr.squadRating < 1100;
        })
      )
        throw Error('Squad qualification not met');
      const id = randomUUID();
      db.prepare('INSERT INTO gathering_sessions(id,squad_id) VALUES (?,?)').run(id, squad.id);
      r.json({ id, approvals: [], verified: false });
    } catch (e) {
      r.status(403).json({ error: (e as Error).message });
    }
  });
  function session(id: string, playerId: string) {
    const s = db.prepare('SELECT * FROM gathering_sessions WHERE id=?').get(id) as any;
    if (!s) throw Error('Unknown gathering');
    const squad = db.prepare('SELECT * FROM squads WHERE id=?').get(s.squad_id) as any;
    const members = JSON.parse(squad.members) as string[];
    if (!members.includes(playerId) || !isHosted(playerId))
      throw Error('Authenticated squad membership required');
    return { s, squad, members };
  }
  app.get('/api/gathering/:id', async (q, r) => {
    try {
      const { s } = session(q.params.id, r.locals.player.id);
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
          { s } = session(q.params.id, p.id);
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
        db.prepare('UPDATE gathering_sessions SET path=?,approvals=? WHERE id=?').run(
          path,
          JSON.stringify([p.id]),
          s.id,
        );
        r.json({ uploaded: true });
      } catch (e) {
        r.status(400).json({ error: (e as Error).message });
      }
    },
  );
  app.post('/api/gathering/:id/approve', async (q, r) => {
    try {
      const { s, members, squad } = session(q.params.id, r.locals.player.id);
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
      db.transaction(() => {
        db.prepare('UPDATE gathering_sessions SET approvals=?,verified=? WHERE id=?').run(
          JSON.stringify(approvals),
          Number(verified),
          s.id,
        );
        if (verified) {
          for (const id of members) {
            const p = profile(id)!;
            p.progress.stage = 3;
            saveProfile(p);
            issueBadge(id, 'Proof of Fellowship', s.id);
          }
        }
      })();
      if (verified && supabase) {
        const sq = await supabase
          .from('squads')
          .upsert({ id: squad.id, name: squad.name, invite_code: squad.code });
        if (sq.error) throw sq.error;
        const out = await supabase.from('lunch_verification_sessions').upsert({
          id: s.id,
          squad_id: squad.id,
          object_path: s.path,
          metadata_hash: hash,
          verified_at: new Date().toISOString(),
          simulated: false,
        });
        if (out.error) throw out.error;
        await supabase
          .from('lunch_approvals')
          .upsert(members.map((id) => ({ session_id: s.id, player_id: id })));
        await supabase
          .from('player_progression')
          .upsert(members.map((id) => ({ player_id: id, progress: profile(id)!.progress })));
      }
      r.json({ approvals, verified, hash });
    } catch (e) {
      r.status(400).json({ error: (e as Error).message });
    }
  });
  app.delete('/api/gathering/:id/photo', async (q, r) => {
    try {
      const { s } = session(q.params.id, r.locals.player.id);
      if (s.path && supabase) {
        const out = await supabase.storage.from('gatherings').remove([s.path]);
        if (out.error) throw out.error;
      }
      db.prepare('UPDATE gathering_sessions SET path=NULL WHERE id=?').run(s.id);
      r.json({ deleted: true });
    } catch (e) {
      r.status(403).json({ error: (e as Error).message });
    }
  });
}
