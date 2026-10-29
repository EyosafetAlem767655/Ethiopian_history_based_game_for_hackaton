import type { AvatarSpec } from '../../../packages/shared/src/customization';
import { db, persistence } from './database';
export { db } from './database';
import {
  freshCampaign,
  completeMission,
  missionEligibility,
  type CampaignProgress,
} from '../../../packages/shared/src/missions';
import { randomUUID, createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { keccak256, stringToHex } from 'viem';
import {
  freshProgress,
  progressResult,
  type Progress,
  type World,
} from '../../../packages/shared/src/game';
await db.exec(`CREATE TABLE IF NOT EXISTS secrets (id TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY,name TEXT NOT NULL,demo INTEGER NOT NULL,hero INTEGER NOT NULL DEFAULT 0,progress TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS results (id TEXT PRIMARY KEY,demo INTEGER NOT NULL,payload TEXT NOT NULL,hash TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS participants (match_id TEXT NOT NULL,player_id TEXT NOT NULL,PRIMARY KEY(match_id,player_id));
CREATE TABLE IF NOT EXISTS badges (player_id TEXT NOT NULL,badge TEXT NOT NULL,match_id TEXT NOT NULL,PRIMARY KEY(player_id,badge));
CREATE TABLE IF NOT EXISTS outbox (match_id TEXT PRIMARY KEY,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,tx TEXT,error TEXT);
CREATE TABLE IF NOT EXISTS squads (id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,demo INTEGER NOT NULL,members TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS gatherings (id TEXT PRIMARY KEY,squad_id TEXT NOT NULL,approvals TEXT NOT NULL,simulated INTEGER NOT NULL,hash TEXT NOT NULL);`);
await db.exec(
  'CREATE TABLE IF NOT EXISTS campaign_progress(player_id TEXT PRIMARY KEY,data TEXT NOT NULL);',
);
export async function campaignProgress(id: string) {
  const row = (await db.prepare('SELECT data FROM campaign_progress WHERE player_id=?').get(id)) as
    | {
        data: string;
      }
    | undefined;
  let value;
  try {
    value = row ? JSON.parse(row.data) : freshCampaign();
  } catch {
    value = freshCampaign();
  }
  if (!value || typeof value !== 'object') value = freshCampaign();
  return {
    ...freshCampaign(),
    ...value,
    completed: Array.isArray(value.completed)
      ? value.completed.filter(
          (n: unknown) => Number.isInteger(n) && Number(n) >= 1 && Number(n) <= 15,
        )
      : [],
    fellowship: !!value.fellowship || ((await profile(id))?.progress.stage ?? 0) >= 3,
  };
}
export async function saveCampaign(id: string, p: CampaignProgress) {
  await db
    .prepare(
      'INSERT INTO campaign_progress VALUES (?,?) ON CONFLICT(player_id) DO UPDATE SET data=excluded.data',
    )
    .run(id, JSON.stringify(p));
}
const squadColumns =
  persistence === 'sqlite'
    ? ((await db.prepare('PRAGMA table_info(squads)').all()) as {
        name: string;
      }[])
    : [{ name: 'rating' }];
if (!squadColumns.some((c) => c.name === 'rating'))
  await db.exec(
    'ALTER TABLE squads ADD COLUMN rating INTEGER NOT NULL DEFAULT 1000; ALTER TABLE squads ADD COLUMN wins INTEGER NOT NULL DEFAULT 0;',
  );
let row = (await db.prepare('SELECT value FROM secrets WHERE id=?').get('session')) as
  | {
      value: string;
    }
  | undefined;
if (!row && persistence === 'sqlite') {
  row = { value: randomBytes(32).toString('hex') };
  await db.prepare('INSERT INTO secrets VALUES (?,?)').run('session', row.value);
}
const secret = process.env.SESSION_SECRET ?? row!.value;
export interface Profile {
  avatar?: AvatarSpec;
  id: string;
  name: string;
  demo: number;
  hero: number;
  progress: Progress;
}
export async function profile(id: string) {
  const r = (await db.prepare('SELECT * FROM profiles WHERE id=?').get(id)) as
    | (Omit<Profile, 'progress'> & {
        progress: string;
      })
    | undefined;
  if (!r) return undefined;
  let saved;
  try {
    saved = JSON.parse(r.progress);
  } catch {
    saved = {};
  }
  return { ...r, progress: { ...freshProgress(), ...saved } };
}
export async function saveProfile(p: Profile) {
  await db
    .prepare('UPDATE profiles SET hero=?,progress=? WHERE id=?')
    .run(p.hero, JSON.stringify(p.progress), p.id);
}
export async function createProfile(name: string, demo: boolean) {
  const id = randomUUID();
  await db
    .prepare('INSERT INTO profiles(id,name,demo,progress) VALUES (?,?,?,?)')
    .run(id, name, Number(demo), JSON.stringify(freshProgress()));
  return (await profile(id))!;
}
export function token(p: Profile) {
  const body = Buffer.from(JSON.stringify({ id: p.id, exp: Date.now() + 7 * 86400000 })).toString(
    'base64url',
  );
  return body + '.' + createHmac('sha256', secret).update(body).digest('base64url');
}
export class SessionError extends Error {}
export async function authenticate(t: unknown) {
  if (typeof t !== 'string' || t.length > 2048) throw new SessionError('Session required');
  const [body, sig] = t.split('.');
  const expected = createHmac('sha256', secret)
    .update(body ?? '')
    .digest('base64url');
  if (
    !sig ||
    sig.length !== expected.length ||
    !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  )
    throw new SessionError('Invalid session');
  let data;
  try {
    data = JSON.parse(Buffer.from(body, 'base64url').toString());
  } catch {
    throw new SessionError('Invalid session');
  }
  if (typeof data.id !== 'string' || !Number.isFinite(data.exp))
    throw new SessionError('Invalid session');
  const p = await profile(data.id);
  if (data.exp < Date.now() || !p) throw new SessionError('Session expired');
  return p;
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return (
    '{' +
    Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
      .join(',') +
    '}'
  );
}
export function digest(value: unknown) {
  return keccak256(stringToHex(canonical(value)));
}
export const issueBadge = async (id: string, badge: string, match: string) =>
  await db.prepare('INSERT OR IGNORE INTO badges VALUES (?,?,?)').run(id, badge, match);
export function recordResult(id: string, w: World, started: string) {
  return db.transaction(async () => {
    if (await db.prepare('SELECT id FROM results WHERE id=?').get(id)) return false;
    const payload = {
      version: w.campaign ? 2 : 1,
      ...(w.campaign
        ? {
            missionId: w.campaign.missionId,
            campaignVersion: w.campaign.version,
            objectives: w.campaign.markers,
            honor: w.campaign.honor,
          }
        : {}),
      matchId: id,
      mode: w.mode,
      stage: w.campaign
        ? Math.ceil(w.campaign.missionId / 5)
        : w.mode === 'quest'
          ? 3
          : w.mode === 'squad'
            ? 2
            : 1,
      demo: w.demo,
      participants: w.players.map((p) => ({
        id: p.id,
        bot: p.bot,
        team: p.team,
        damage: p.damage,
        kills: p.kills,
        contribution: p.contribution,
        ...(w.campaign ? { honor: p.honor ?? 0 } : {}),
      })),
      winner: w.winner,
      scoreline: w.scores,
      startedAt: started,
      endedAt: new Date().toISOString(),
      validatedBy: 'authoritative-server',
      events: w.events,
      champion: w.champion,
    };
    const serialized = canonical(payload),
      hash = digest(payload);
    await db
      .prepare('INSERT INTO results VALUES (?,?,?,?,?)')
      .run(id, Number(w.demo), serialized, hash, payload.endedAt);
    await db
      .prepare('INSERT INTO outbox(match_id,status) VALUES (?,?)')
      .run(id, !w.demo && process.env.ALLOW_CHAIN_BROADCAST === 'true' ? 'pending' : 'simulated');
    for (const f of w.players) {
      const p = await profile(f.id);
      if (!p) continue;
      if (w.campaign) {
        if (
          f.team === w.winner &&
          !missionEligibility(await campaignProgress(p.id), w.campaign.missionId, w.demo)
        ) {
          const old = await campaignProgress(p.id),
            first = !old.completed.includes(w.campaign.missionId);
          await saveCampaign(
            p.id,
            completeMission(old, w.campaign.missionId, f.honor ?? 0, f.contribution),
          );
          p.progress.xp += first ? 100 : 20;
          p.progress.points += first ? 100 : 0;
          if (w.campaign.missionId === 5) p.progress.stage = Math.max(2, p.progress.stage);
        }
      } else
        p.progress = progressResult(
          p.progress,
          f.team === w.winner,
          w.mode,
          w.demo,
          f.contribution,
        );
      await saveProfile(p);
      await db.prepare('INSERT INTO participants VALUES (?,?)').run(id, p.id);
      if (w.mode === 'tutorial') continue;
      if (f.team === w.winner) {
        await issueBadge(p.id, 'First Blood', id);
        if (w.campaign?.missionId === 2) await issueBadge(p.id, 'Royal Rider', id);
        if (w.campaign?.missionId === 6) await issueBadge(p.id, 'Four Banners Champion', id);
        if (w.campaign?.missionId === 14) await issueBadge(p.id, 'Guardian Slayer', id);
        if (w.campaign?.missionId === 15) {
          await issueBadge(p.id, 'Thronebreaker', id);
          if (w.champion === p.id) await issueBadge(p.id, 'Crown Champion', id);
        }
        if (w.mode === 'duel' && p.progress.wins >= 3) await issueBadge(p.id, 'Sword Master', id);
        if (w.mode === 'squad' && f.damage >= 50) {
          if (f.role === 'spear') await issueBadge(p.id, 'Spear Master', id);
          if (f.role === 'archer') await issueBadge(p.id, 'Eagle Eye', id);
          if (f.role === 'rider') await issueBadge(p.id, 'Royal Rider', id);
        }
        if (w.mode === 'squad') await issueBadge(p.id, 'Four Banners Champion', id);
        if (w.mode === 'quest') {
          await issueBadge(p.id, 'Guardian Slayer', id);
          await issueBadge(p.id, 'Thronebreaker', id);
          if (w.champion === p.id) await issueBadge(p.id, 'Crown Champion', id);
        }
      }
      if (p.progress.qualifying >= 10) await issueBadge(p.id, 'Ten Victories', id);
    }
    if (w.mode === 'squad') {
      const squads = (await db
        .prepare('SELECT * FROM squads WHERE demo=?')
        .all(Number(w.demo))) as any[];
      for (const squad of squads) {
        const members = JSON.parse(squad.members) as string[];
        const participant = w.players.find((p) => members.includes(p.id));
        if (!participant) continue;
        const win = participant.team === w.winner,
          rating = Math.max(0, squad.rating + (win ? 50 : -25)),
          wins = squad.wins + Number(win);
        await db
          .prepare('UPDATE squads SET rating=?,wins=? WHERE id=?')
          .run(rating, wins, squad.id);
        for (const member of members) {
          const p = await profile(member);
          if (p) {
            p.progress.squadRating = rating;
            p.progress.squadWins = wins;
            await saveProfile(p);
          }
        }
      }
    }
    return true;
  })();
}
export async function history(id: string) {
  return await db
    .prepare(
      `SELECT r.*,o.status,o.tx FROM results r JOIN participants p ON p.match_id=r.id JOIN outbox o ON o.match_id=r.id WHERE p.player_id=? ORDER BY r.created DESC LIMIT 30`,
    )
    .all(id);
}
export async function badges(id: string) {
  return await db.prepare('SELECT badge,match_id FROM badges WHERE player_id=?').all(id);
}
