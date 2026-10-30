import 'dotenv/config';
import Database from 'better-sqlite3';
import postgres from 'postgres';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { equivalentImportRow } from './import-compare';
const source =
  process.argv.find((x) => x.startsWith('--source='))?.slice(9) ?? 'data/knights.sqlite';
const apply = process.argv.includes('--apply');
if (apply && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32))
  throw Error('Apply requires the active SESSION_SECRET (at least 32 characters)');
const db = new Database(resolve(source), { readonly: true, fileMustExist: true });
const tables = [
  'profiles',
  'results',
  'participants',
  'badges',
  'outbox',
  'squads',
  'gatherings',
  'campaign_progress',
  'hosted_identities',
  'hosted_outbox',
  'gathering_sessions',
  'wallets',
  'wallet_nonces',
  'avatars',
  'age_reviews',
  'team_messages',
  'revoked_sessions',
  'web3_jobs',
  'web3_challenges',
  'media_deletions',
];
const existing = new Set(
  (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]).map(
    (r) => r.name,
  ),
);
const integrity = db.pragma('quick_check', { simple: true });
if (integrity !== 'ok') throw Error('Source integrity check failed');
const rows = Object.fromEntries(
  tables
    .filter((t) => existing.has(t))
    .map((t) => [
      t,
      db
        .prepare(`SELECT * FROM ${t}${t === 'team_messages' ? ' ORDER BY seq' : ''}`)
        .all() as Record<string, unknown>[],
    ]),
);
const fingerprint = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
console.log('Source checked. Mode:', apply ? 'APPLY' : 'DRY RUN', 'fingerprint:', fingerprint);
for (const [table, values] of Object.entries(rows)) console.log(table, values.length);
if (!process.env.SUPABASE_DB_URL) {
  if (apply) throw Error('SUPABASE_DB_URL required');
  console.log('No target configured: source validation only.');
  db.close();
  process.exit(0);
}
const pg = postgres(process.env.SUPABASE_DB_URL, {
  ssl: {
    rejectUnauthorized: true,
    ca: process.env.SUPABASE_DB_CA?.replace(/\\n/g, '\n') || undefined,
  },
  prepare: false,
  max: 1,
});
try {
  await pg.begin(async (sql) => {
    await sql`select pg_advisory_xact_lock(731044830)`;
    const stored = db.prepare("SELECT value FROM secrets WHERE id='session'").get() as
      | { value: string }
      | undefined;
    if (
      apply &&
      stored &&
      !process.argv.includes('--external-secret') &&
      process.env.SESSION_SECRET !== stored.value
    )
      throw Error(
        'Set SESSION_SECRET to the source active signing secret before importing. If source used an env override, pass --external-secret.',
      );
    let conflicts = 0,
      duplicates = 0,
      inserted = 0;
    for (const [table, values] of Object.entries(rows)) {
      const columns = (
        await sql.unsafe(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='game_runtime' AND table_name=$1",
          [table],
        )
      ).map((c) => c.column_name as string);
      for (const value of values) {
        if (table === 'hosted_identities' && !value.auth_id) value.auth_id = null;
        // Preserve message order while letting Postgres allocate its own sequence.
        const keys = Object.keys(value).filter(
          (k) => columns.includes(k) && !(table === 'team_messages' && k === 'seq'),
        );
        const primary =
          table === 'media_deletions'
            ? ['bucket', 'path']
            : table === 'revoked_sessions'
              ? ['digest']
              : table === 'participants'
                ? ['match_id', 'player_id']
                : table === 'badges'
                  ? ['player_id', 'badge']
                  : table === 'campaign_progress' ||
                      table === 'wallets' ||
                      table === 'wallet_nonces' ||
                      table === 'avatars' ||
                      table === 'web3_challenges'
                    ? ['player_id']
                    : table === 'outbox' || table === 'hosted_outbox'
                      ? ['match_id']
                      : ['id'];
        const old = await sql.unsafe(
          `SELECT * FROM game_runtime.${table} WHERE ` +
            primary.map((k, n) => `${k}=$${n + 1}`).join(' AND '),
          primary.map((k) => value[k]) as any[],
        );
        if (old[0]) {
          if (
            table === 'hosted_identities' &&
            value.auth_id === null &&
            old[0].auth_id === value.id
          )
            value.auth_id = old[0].auth_id;
          if (equivalentImportRow(table, keys, old[0], value)) duplicates++;
          else conflicts++;
          continue;
        }
        if (apply)
          await sql.unsafe(
            `INSERT INTO game_runtime.${table}(${keys.join(',')}) VALUES (${keys.map((_, n) => '$' + (n + 1)).join(',')})`,
            keys.map((k) => value[k]) as any[],
          );
        inserted++;
      }
    }
    console.log({ duplicates, conflicts, [apply ? 'inserted' : 'wouldInsert']: inserted });
    if (conflicts)
      throw Error(
        'Conflicting target records found. No changes committed; reconcile them before retrying.',
      );
    if (apply) {
      mkdirSync('output/backups', { recursive: true });
      await db.backup(`output/backups/pre-import-${randomUUID()}.sqlite`);
    }
  });
} finally {
  await pg.end();
  db.close();
}
