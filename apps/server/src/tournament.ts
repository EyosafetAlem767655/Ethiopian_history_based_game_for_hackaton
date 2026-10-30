import type { Express } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, issueBadge, profile, saveProfile } from './store';
import { assertParty } from './customization';
import { notify } from './notify';

await db.exec(`CREATE TABLE IF NOT EXISTS tournaments(
  id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, demo INTEGER NOT NULL, owner TEXT NOT NULL,
  entrants TEXT NOT NULL, bracket TEXT NOT NULL, status TEXT NOT NULL, winner TEXT, created INTEGER NOT NULL
);`);

export interface Entrant {
  id: string;
  name: string;
  bot: boolean;
}
export type MatchKey = 'semi1' | 'semi2' | 'final';
export interface BracketMatch {
  key: MatchKey;
  a?: string;
  b?: string;
  winner?: string;
}
export interface Tournament {
  id: string;
  code: string;
  demo: number;
  owner: string;
  entrants: Entrant[];
  bracket: BracketMatch[];
  status: 'open' | 'running' | 'done';
  winner?: string | null;
}
export const TOURNAMENT_SIZE = 4;
export const MATCH_WIN_POINTS = 50;
export const CHAMPION_POINTS = 150;
const AI_NAMES = ['Ras Alula · AI', 'Itege Taytu · AI', 'Abba Gobena · AI', 'Ras Mengesha · AI'];

function parse(row: any): Tournament | undefined {
  if (!row) return undefined;
  return {
    ...row,
    demo: Number(row.demo),
    entrants: JSON.parse(row.entrants),
    bracket: JSON.parse(row.bracket),
  };
}
export async function tournament(id: string) {
  return parse(await db.prepare('SELECT * FROM tournaments WHERE id=?').get(id));
}
async function save(t: Tournament) {
  await db
    .prepare('UPDATE tournaments SET entrants=?,bracket=?,status=?,winner=? WHERE id=?')
    .run(JSON.stringify(t.entrants), JSON.stringify(t.bracket), t.status, t.winner ?? null, t.id);
}
const fail = (status: number, message: string) => Object.assign(Error(message), { status });
const entrant = (t: Tournament, id?: string) => t.entrants.find((e) => e.id === id);
const nameOf = (t: Tournament, id?: string) => entrant(t, id)?.name ?? 'TBD';

/** Settle every match whose two entrants are both AI, and fill the final once semis finish. */
async function advance(t: Tournament) {
  for (let pass = 0; pass < 3; pass++) {
    const final = t.bracket.find((m) => m.key === 'final')!;
    const semis = t.bracket.filter((m) => m.key !== 'final');
    if (semis.every((m) => m.winner) && !final.a) {
      final.a = semis[0].winner;
      final.b = semis[1].winner;
      for (const id of [final.a, final.b])
        await notify(
          id!,
          'tournament',
          `Your tournament final is ready: ${nameOf(t, final.a)} vs ${nameOf(t, final.b)}.`,
          {
            tournamentId: t.id,
          },
        );
    }
    for (const m of t.bracket)
      if (m.a && m.b && !m.winner && entrant(t, m.a)?.bot && entrant(t, m.b)?.bot)
        m.winner = Math.random() < 0.5 ? m.a : m.b;
  }
  const final = t.bracket.find((m) => m.key === 'final')!;
  if (final.winner && t.status !== 'done') {
    t.status = 'done';
    t.winner = final.winner;
    const champion = entrant(t, final.winner)!;
    if (!champion.bot) {
      const p = await profile(champion.id);
      if (p) {
        p.progress.points += CHAMPION_POINTS;
        await saveProfile(p);
      }
      await issueBadge(champion.id, 'Tournament Champion', 'tournament:' + t.id);
    }
    for (const e of t.entrants)
      await notify(e.id, 'tournament', `${champion.name} won the tournament!`, {
        tournamentId: t.id,
      });
  }
}

/** Called by the duel room once a tournament match result is saved. First result wins. */
export async function reportTournamentMatch(id: string, key: MatchKey, winner: string) {
  return db.transaction(async () => {
    const t = await tournament(id);
    const m = t?.bracket.find((b) => b.key === key);
    if (!t || !m || m.winner || ![m.a, m.b].includes(winner)) return;
    m.winner = winner;
    const won = entrant(t, winner)!;
    if (!won.bot) {
      const p = await profile(won.id);
      if (p) {
        p.progress.points += MATCH_WIN_POINTS;
        await saveProfile(p);
      }
    }
    for (const e of [m.a, m.b])
      await notify(
        e!,
        'tournament',
        `${won.name} won the ${key === 'final' ? 'final' : 'semifinal'}.`,
        {
          tournamentId: t.id,
        },
      );
    await advance(t);
    await save(t);
  })();
}

/** Which tournament match a player may play now, and whether the opponent is a human. */
export async function tournamentSeat(id: string, key: string, playerId: string) {
  const t = await tournament(id);
  const m = t?.bracket.find((b) => b.key === key);
  if (!t || t.status !== 'running' || !m || m.winner || ![m.a, m.b].includes(playerId))
    throw Error('This tournament match is not yours to play.');
  const opponent = entrant(t, m.a === playerId ? m.b : m.a);
  return { tournament: t, match: m, humanOpponent: !!opponent && !opponent.bot };
}

export function registerTournamentRoutes(app: Express) {
  app.post('/api/tournament', async (_q, r) => {
    const me = r.locals.player;
    const t: Tournament = {
      id: randomUUID(),
      code: randomBytes(3).toString('hex').toUpperCase(),
      demo: me.demo,
      owner: me.id,
      entrants: [{ id: me.id, name: me.name, bot: false }],
      bracket: [{ key: 'semi1' }, { key: 'semi2' }, { key: 'final' }],
      status: 'open',
    };
    await db
      .prepare(
        'INSERT INTO tournaments(id,code,demo,owner,entrants,bracket,status,created) VALUES (?,?,?,?,?,?,?,?)',
      )
      .run(
        t.id,
        t.code,
        t.demo,
        t.owner,
        JSON.stringify(t.entrants),
        JSON.stringify(t.bracket),
        t.status,
        Date.now(),
      );
    r.json(t);
  });
  app.post('/api/tournament/join', async (q, r) => {
    const me = r.locals.player;
    const { code } = z.object({ code: z.string().trim().toUpperCase() }).parse(q.body);
    const t = parse(
      await db.prepare('SELECT * FROM tournaments WHERE code=? AND demo=?').get(code, me.demo),
    );
    if (!t) throw fail(404, 'No tournament with that code.');
    if (!entrant(t, me.id)) {
      if (t.status !== 'open') throw fail(409, 'That tournament has already started.');
      if (t.entrants.length >= TOURNAMENT_SIZE) throw fail(409, 'That tournament is full.');
      await assertParty([...t.entrants.map((e) => e.id), me.id]);
      t.entrants.push({ id: me.id, name: me.name, bot: false });
      await save(t);
      for (const e of t.entrants)
        if (e.id !== me.id)
          await notify(e.id, 'tournament', `${me.name} joined your tournament.`, {
            tournamentId: t.id,
          });
    }
    r.json(t);
  });
  app.get('/api/tournament/:id', async (q, r) => {
    const t = await tournament(q.params.id);
    if (!t || !entrant(t, r.locals.player.id)) throw fail(404, 'Tournament not found.');
    r.json(t);
  });
  app.post('/api/tournament/:id/start', async (q, r) => {
    const me = r.locals.player;
    const t = await tournament(q.params.id);
    if (!t || t.owner !== me.id) throw fail(403, 'Only the organizer can start the tournament.');
    if (t.status !== 'open') throw fail(409, 'The tournament has already started.');
    for (let n = 0; t.entrants.length < TOURNAMENT_SIZE; n++)
      t.entrants.push({ id: 'ai-' + randomUUID().slice(0, 8), name: AI_NAMES[n], bot: true });
    const order = [...t.entrants].sort(() => Math.random() - 0.5);
    t.bracket = [
      { key: 'semi1', a: order[0].id, b: order[1].id },
      { key: 'semi2', a: order[2].id, b: order[3].id },
      { key: 'final' },
    ];
    t.status = 'running';
    await advance(t);
    await save(t);
    for (const e of t.entrants)
      if (e.id !== me.id)
        await notify(e.id, 'tournament', 'Your tournament has started. Play your semifinal!', {
          tournamentId: t.id,
        });
    r.json(t);
  });
}
