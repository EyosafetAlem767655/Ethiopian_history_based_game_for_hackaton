-- Additive upgrade: friends, notifications and tournaments for the game server only.
create table if not exists game_runtime.notifications (
  id text primary key,
  player_id text not null,
  kind text not null,
  text text not null,
  data text not null,
  at bigint not null,
  seen integer not null default 0
);
create index if not exists notification_feed on game_runtime.notifications(player_id,at desc);

create table if not exists game_runtime.friends (
  player_id text not null,
  friend_id text not null,
  status text not null check (status in ('pending','accepted')),
  created bigint not null,
  primary key(player_id,friend_id)
);
create index if not exists friend_requests on game_runtime.friends(friend_id);

create table if not exists game_runtime.tournaments (
  id text primary key,
  code text unique not null,
  demo integer not null,
  owner text not null,
  entrants text not null,
  bracket text not null,
  status text not null,
  winner text,
  created bigint not null
);

alter table game_runtime.notifications enable row level security;
alter table game_runtime.friends enable row level security;
alter table game_runtime.tournaments enable row level security;
-- Authorization belongs to the game server; browser roles cannot read these tables.
revoke all on game_runtime.notifications from public, anon, authenticated;
revoke all on game_runtime.friends from public, anon, authenticated;
revoke all on game_runtime.tournaments from public, anon, authenticated;
