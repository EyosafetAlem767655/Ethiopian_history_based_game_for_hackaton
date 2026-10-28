import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { randomUUID, createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { keccak256, stringToHex } from 'viem';
import {
  freshProgress,
  progressResult,
  type Progress,
  type World,
} from '../../../packages/shared/src/game';
mkdirSync('data', { recursive: true });
export const db = new Database(process.env.DB_PATH ?? 'data/knights.sqlite');
db.pragma('journal_mode = WAL');
db.exec(`CREATE TABLE IF NOT EXISTS secrets (id TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY,name TEXT NOT NULL,demo INTEGER NOT NULL,hero INTEGER NOT NULL DEFAULT 0,progress TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS results (id TEXT PRIMARY KEY,demo INTEGER NOT NULL,payload TEXT NOT NULL,hash TEXT NOT NULL,created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS participants (match_id TEXT NOT NULL,player_id TEXT NOT NULL,PRIMARY KEY(match_id,player_id));
CREATE TABLE IF NOT EXISTS badges (player_id TEXT NOT NULL,badge TEXT NOT NULL,match_id TEXT NOT NULL,PRIMARY KEY(player_id,badge));
CREATE TABLE IF NOT EXISTS outbox (match_id TEXT PRIMARY KEY,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,tx TEXT,error TEXT);
CREATE TABLE IF NOT EXISTS squads (id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,demo INTEGER NOT NULL,members TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS gatherings (id TEXT PRIMARY KEY,squad_id TEXT NOT NULL,approvals TEXT NOT NULL,simulated INTEGER NOT NULL,hash TEXT NOT NULL);`);
const squadColumns = db.prepare('PRAGMA table_info(squads)').all() as { name: string }[];
if (!squadColumns.some((c) => c.name === 'rating'))
  db.exec(
    'ALTER TABLE squads ADD COLUMN rating INTEGER NOT NULL DEFAULT 1000; ALTER TABLE squads ADD COLUMN wins INTEGER NOT NULL DEFAULT 0;',
  );
let row = db.prepare('SELECT value FROM secrets WHERE id=?').get('session') as
  | { value: string }
  | undefined;
if (!row) {
  row = { value: randomBytes(32).toString('hex') };
  db.prepare('INSERT INTO secrets VALUES (?,?)').run('session', row.value);
}
const secret = process.env.SESSION_SECRET ?? row.value;
export interface Profile {
  id: string;
  name: string;
  demo: number;
  hero: number;
  progress: Progress;
}
export function profile(id: string): Profile | undefined {
  const r = db.prepare('SELECT * FROM profiles WHERE id=?').get(id) as
    | (Omit<Profile, 'progress'> & { progress: string })
    | undefined;
  return r ? { ...r, progress: JSON.parse(r.progress) } : undefined;
}
export function saveProfile(p: Profile) {
  db.prepare('UPDATE profiles SET hero=?,progress=? WHERE id=?').run(
    p.hero,
    JSON.stringify(p.progress),
    p.id,
  );
}
export function createProfile(name: string, demo: boolean) {
  const id = randomUUID();
  db.prepare('INSERT INTO profiles(id,name,demo,progress) VALUES (?,?,?,?)').run(
    id,
    name,
    Number(demo),
    JSON.stringify(freshProgress()),
  );
  return profile(id)!;
}
export function token(p: Profile) {
  const body = Buffer.from(JSON.stringify({ id: p.id, exp: Date.now() + 7 * 86400000 })).toString(
    'base64url',
  );
  return body + '.' + createHmac('sha256', secret).update(body).digest('base64url');
}
export function authenticate(t: unknown): Profile {
  if (typeof t !== 'string') throw Error('Session required');
  const [body, sig] = t.split('.');
  const expected = createHmac('sha256', secret)
    .update(body ?? '')
    .digest('base64url');
  if (
    !sig ||
    sig.length !== expected.length ||
    !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  )
    throw Error('Invalid session');
  const data = JSON.parse(Buffer.from(body, 'base64url').toString());
  const p = profile(data.id);
  if (data.exp < Date.now() || !p) throw Error('Session expired');
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
export const issueBadge = (id: string, badge: string, match: string) =>
  db.prepare('INSERT OR IGNORE INTO badges VALUES (?,?,?)').run(id, badge, match);
export function recordResult(id: string, w: World, started: string) {
  return db.transaction(() => {
    if (db.prepare('SELECT id FROM results WHERE id=?').get(id)) return false;
    const payload = {
      version: 1,
      matchId: id,
      mode: w.mode,
      stage: w.mode === 'quest' ? 3 : w.mode === 'squad' ? 2 : 1,
      demo: w.demo,
      participants: w.players.map((p) => ({
        id: p.id,
        bot: p.bot,
        team: p.team,
        damage: p.damage,
        kills: p.kills,
        contribution: p.contribution,
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
    db.prepare('INSERT INTO results VALUES (?,?,?,?,?)').run(
      id,
      Number(w.demo),
      serialized,
      hash,
      payload.endedAt,
    );
    db.prepare('INSERT INTO outbox(match_id,status) VALUES (?,?)').run(
      id,
      !w.demo && process.env.ALLOW_CHAIN_BROADCAST === 'true' ? 'pending' : 'simulated',
    );
    for (const f of w.players.filter((p) => profile(p.id))) {
      const p = profile(f.id);
      if (!p) continue;
      p.progress = progressResult(p.progress, f.team === w.winner, w.mode, w.demo, f.contribution);
      saveProfile(p);
      db.prepare('INSERT INTO participants VALUES (?,?)').run(id, p.id);
      if (w.mode === 'tutorial') continue;
      if (f.team === w.winner) {
        issueBadge(p.id, 'First Blood', id);
        if (w.mode === 'duel' && p.progress.wins >= 3) issueBadge(p.id, 'Sword Master', id);
        if (w.mode === 'squad' && f.damage >= 50) {
          if (f.role === 'spear') issueBadge(p.id, 'Spear Master', id);
          if (f.role === 'archer') issueBadge(p.id, 'Eagle Eye', id);
          if (f.role === 'rider') issueBadge(p.id, 'Royal Rider', id);
        }
        if (w.mode === 'squad') issueBadge(p.id, 'Four Banners Champion', id);
        if (w.mode === 'quest') {
          issueBadge(p.id, 'Guardian Slayer', id);
          issueBadge(p.id, 'Thronebreaker', id);
          if (w.champion === p.id) issueBadge(p.id, 'Crown Champion', id);
        }
      }
      if (p.progress.qualifying >= 10) issueBadge(p.id, 'Ten Victories', id);
    }
    if (w.mode === 'squad') {
      const squads = db.prepare('SELECT * FROM squads WHERE demo=?').all(Number(w.demo)) as any[];
      for (const squad of squads) {
        const members = JSON.parse(squad.members) as string[];
        const participant = w.players.find((p) => members.includes(p.id));
        if (!participant) continue;
        const win = participant.team === w.winner,
          rating = Math.max(0, squad.rating + (win ? 50 : -25)),
          wins = squad.wins + Number(win);
        db.prepare('UPDATE squads SET rating=?,wins=? WHERE id=?').run(rating, wins, squad.id);
        for (const member of members) {
          const p = profile(member);
          if (p) {
            p.progress.squadRating = rating;
            p.progress.squadWins = wins;
            saveProfile(p);
          }
        }
      }
    }
    return true;
  })();
}
export function history(id: string) {
  return db
    .prepare(
      `SELECT r.*,o.status,o.tx FROM results r JOIN participants p ON p.match_id=r.id JOIN outbox o ON o.match_id=r.id WHERE p.player_id=? ORDER BY r.created DESC LIMIT 30`,
    )
    .all(id);
}
export function badges(id: string) {
  return db.prepare('SELECT badge,match_id FROM badges WHERE player_id=?').all(id);
}
