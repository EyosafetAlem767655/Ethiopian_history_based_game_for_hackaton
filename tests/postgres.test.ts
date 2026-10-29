import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { postgresSQL } from '../apps/server/src/sql';
import { equivalentImportRow } from '../scripts/import-compare';
it('recognizes semantically identical legacy JSON without merging conflicting progression', () => {
  expect(
    equivalentImportRow(
      'profiles',
      ['progress'],
      { progress: '{"wins":2,"rating":1100}' },
      { progress: '{ "rating": 1100, "wins": 2 }' },
    ),
  ).toBe(true);
  expect(
    equivalentImportRow(
      'profiles',
      ['progress'],
      { progress: '{"wins":2}' },
      { progress: '{"wins":3}' },
    ),
  ).toBe(false);
  expect(
    equivalentImportRow(
      'results',
      ['created'],
      { created: '2026-01-01T00:00:00Z' },
      { created: '2026-01-01 00:00:00+00' },
    ),
  ).toBe(true);
});
it('applies additive upgrades to PostgreSQL, preserves legacy records and restricts evidence RPCs', async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`create role anon;create role authenticated;create role service_role;
 create schema auth; create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql as 'select null::uuid';
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
    const one = readFileSync('supabase/migrations/001_royal_trials.sql', 'utf8').replace(
      'create extension if not exists pgcrypto;',
      '',
    );
    await pg.exec(one);
    await pg.exec(readFileSync('supabase/migrations/002_campaign.sql', 'utf8'));
    const id = '00000000-0000-4000-8000-000000000001';
    await pg.query('insert into auth.users values($1)', [id]);
    await pg.query('insert into public.profiles(id,nickname) values($1,$2)', [id, 'Legacy']);
    await pg.query('insert into public.player_progression values($1,$2)', [
      id,
      { rating: 1600, wins: 12 },
    ]);
    await pg.exec(readFileSync('supabase/migrations/003_runtime.sql', 'utf8'));
    await pg.exec(readFileSync('supabase/migrations/004_evidence_cleanup.sql', 'utf8'));
    expect(
      (await pg.query<any>('select progress from game_runtime.profiles where id=$1', [id])).rows[0]
        .progress,
    ).toContain('1600');
    expect((await pg.query<any>("select game_runtime.safe_rating('broken') r")).rows[0].r).toBe(
      '1000',
    );
    await pg.query(
      "insert into game_runtime.age_reviews(id,player_id,status,path,birth_date,created,expires) values('expired',$1,'pending','private/image','2000-01-01',0,1)",
      [id],
    );
    const jobs = await pg.query<any>('select * from public.expired_age_evidence()');
    expect(jobs.rows).toEqual([{ id: 'expired', path: 'private/image' }]);
    expect(
      (
        await pg.query<any>(
          "select birth_date,status from game_runtime.age_reviews where id='expired'",
        )
      ).rows[0],
    ).toEqual({ birth_date: null, status: 'expired' });
    await pg.query('select public.ack_age_evidence($1,$2)', ['expired', 'private/image']);
    expect(
      (await pg.query<any>("select path from game_runtime.age_reviews where id='expired'")).rows[0]
        .path,
    ).toBeNull();
    // Exercise the actual server dialect without setting search_path, as with transaction pooling.
    await pg.query(postgresSQL('INSERT OR REPLACE INTO wallet_nonces VALUES (?,?,?)'), [
      id,
      'first',
      1770000000000,
    ]);
    await pg.query(postgresSQL('INSERT OR REPLACE INTO wallet_nonces VALUES (?,?,?)'), [
      id,
      'second',
      1770000000001,
    ]);
    expect(
      (await pg.query<any>(postgresSQL('SELECT nonce FROM wallet_nonces WHERE player_id=?'), [id]))
        .rows[0].nonce,
    ).toBe('second');
    for (let n = 0; n < 2; n++)
      await pg.query(postgresSQL('INSERT OR IGNORE INTO badges VALUES (?,?,?)'), [
        id,
        'Test Badge',
        'once',
      ]);
    expect(
      (await pg.query<any>(postgresSQL('SELECT * FROM badges WHERE player_id=?'), [id])).rows,
    ).toHaveLength(1);
    expect(
      postgresSQL('SELECT p.id FROM profiles p JOIN participants a ON a.player_id=p.id'),
    ).toContain('JOIN game_runtime.participants');
    await pg.exec('set role authenticated');
    await expect(pg.query('select * from game_runtime.age_reviews')).rejects.toThrow();
    await expect(pg.query('select * from public.expired_age_evidence()')).rejects.toThrow();
  } finally {
    await pg.close();
  }
}, 60000);
