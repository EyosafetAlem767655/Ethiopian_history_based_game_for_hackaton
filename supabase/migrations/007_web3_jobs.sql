create table if not exists game_runtime.web3_challenges (
  player_id text primary key, data text not null, expires bigint not null
);
create table if not exists game_runtime.web3_jobs (
  id text primary key, player_id text not null, kind text not null check(kind in ('profile','badge')),
  payload text not null, status text not null check(status in ('simulated','pending','processing','confirmed','failed')),
  attempts integer not null default 0, next_attempt bigint not null default 0,
  lease_until bigint not null default 0, tx text, error text, created bigint not null
);
create index if not exists web3_player on game_runtime.web3_jobs(player_id,created);
create index if not exists web3_pending on game_runtime.web3_jobs(status,next_attempt);
alter table game_runtime.web3_challenges enable row level security;
alter table game_runtime.web3_jobs enable row level security;
revoke all on game_runtime.web3_challenges, game_runtime.web3_jobs from public, anon, authenticated;
