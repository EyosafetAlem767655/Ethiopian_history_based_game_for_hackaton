import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { io } from 'socket.io-client';
import { world, fighter } from '../packages/shared/src/game';
import { parseResult, verifyPayload } from '../packages/shared/src/results';
import type { ChatAck, TeamMessage } from '../packages/shared/src/chat';

const fixture = vi.hoisted(() => ({ pg: null as PGlite | null }));
// Substitute only the database transport. Runtime SQL, transactions, wallet/proof/chat
// modules and migrations are real; no hosted credentials or blockchain funds are used.
vi.mock('postgres', () => ({
  default: () => {
    const client = (executor: any): any => {
      const query = async (sql: string, values: unknown[] = []) => {
        const result = await executor.query(sql, values);
        return Object.assign(result.rows, { count: result.affectedRows ?? result.rows.length });
      };
      const sql: any = (parts: TemplateStringsArray, ...values: unknown[]) =>
        query(
          parts.reduce((s, part, i) => s + (i ? '$' + i : '') + part, ''),
          values,
        );
      sql.unsafe = query;
      sql.begin = (fn: (transaction: any) => Promise<unknown>) =>
        fixture.pg!.transaction((transaction) => fn(client(transaction)));
      sql.end = async () => {};
      return sql;
    };
    return client(fixture.pg!);
  },
}));

it('runs wallet linking, identity snapshots and private chat through the Postgres adapter', async () => {
  const pg = new PGlite();
  fixture.pg = pg;
  process.env.PERSISTENCE = 'supabase';
  process.env.SUPABASE_DB_URL = 'postgres://fixture.invalid/runtime';
  process.env.SESSION_SECRET = 'synthetic-postgres-session-secret-for-tests';
  process.env.WALLET_ORIGIN = 'http://localhost:5173';
  const server = createServer();
  const sockets: ReturnType<typeof io>[] = [];
  try {
    await pg.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql as 'select null::uuid';
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
    for (const name of [
      '001_royal_trials',
      '002_campaign',
      '003_runtime',
      '004_evidence_cleanup',
      '005_team_chat',
    ]) {
      const sql = readFileSync('supabase/migrations/' + name + '.sql', 'utf8').replace(
        'create extension if not exists pgcrypto;',
        '',
      );
      await pg.exec(sql);
      if (name === '005_team_chat') await pg.exec(sql); // Additive upgrade can be retried.
    }
    const store = await import('../apps/server/src/store');
    const wallet = await import('../apps/server/src/wallet');
    const { resultProof } = await import('../apps/server/src/result-proof');
    const { registerTeamChat, currentSquad } = await import('../apps/server/src/chat');
    const player = await store.createProfile('Postgres Sam', true);
    const account = privateKeyToAccount(generatePrivateKey());
    const challenge = await wallet.issueWalletChallenge(player.id, account.address);
    const signature = await account.signMessage({ message: challenge.message });
    await expect(wallet.bindWallet(player.id, account.address, signature)).resolves.toMatchObject({
      playerId: `eip155:84532:${account.address.toLowerCase()}`,
      registration: 'off-chain',
    });
    await expect(wallet.bindWallet(player.id, account.address, signature)).rejects.toThrow(
      'fresh signing challenge',
    );
    const w = world('duel', true);
    w.players = [fighter(player.id, player.name), fighter('pg-bot', 'AI opponent', 1, true)];
    w.winner = 0;
    w.finished = true;
    await store.recordResult('pg-match', w, new Date().toISOString());
    const proof = (await resultProof('pg-match', player.id))!;
    expect(verifyPayload(proof).status).toBe('match');
    expect(parseResult(proof.payload).participants[0].identity).toMatchObject({ kind: 'wallet' });
    const team = randomUUID();
    await store.db
      .prepare('INSERT INTO squads(id,code,name,demo,members) VALUES (?,?,?,?,?)')
      .run(team, 'PGTEAM', 'Postgres team', 1, JSON.stringify([player.id]));
    expect((await currentSquad(player.id, 1))?.members).toEqual([
      { id: player.id, name: player.name },
    ]);
    expect(await currentSquad('outsider', 1)).toBeNull();
    const chat = registerTeamChat(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    async function connect() {
      const socket = io(base, {
        auth: { token: store.token(player), squadId: team },
        transports: ['websocket'],
        autoConnect: false,
        forceNew: true,
        extraHeaders: { Origin: base },
      });
      sockets.push(socket);
      const history = new Promise<TeamMessage[]>((resolve) => socket.once('chat:history', resolve));
      const connected = new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      socket.connect();
      await connected;
      return { socket, history: await history };
    }
    const first = await connect();
    expect(first.history).toEqual([]);
    const clientId = randomUUID();
    const send = () =>
      new Promise<ChatAck>((resolve, reject) => {
        first.socket
          .timeout(3000)
          .emit(
            'chat:send',
            { clientId, text: 'Postgres chat survives reconnect' },
            (error: Error | null, ack: ChatAck) => (error ? reject(error) : resolve(ack)),
          );
      });
    const [one, retry] = await Promise.all([send(), send()]);
    expect(one.ok).toBe(true);
    expect(retry).toEqual(one);
    const saved = await store.db.prepare('SELECT * FROM team_messages WHERE squad_id=?').all(team);
    expect(saved).toHaveLength(1);
    first.socket.disconnect();
    const second = await connect();
    expect(second.history).toMatchObject([
      { playerId: player.id, text: 'Postgres chat survives reconnect' },
    ]);
    expect(typeof second.history[0].at).toBe('number');
    for (const socket of sockets) socket.disconnect();
    await new Promise<void>((resolve) => chat.close(() => resolve()));
    await pg.exec('set role authenticated');
    await expect(pg.query('select * from game_runtime.team_messages')).rejects.toThrow();
  } finally {
    for (const socket of sockets) socket.disconnect();
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await pg.close();
  }
}, 60000);
