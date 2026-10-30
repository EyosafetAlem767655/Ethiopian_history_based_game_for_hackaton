-- Additive: existing signed sessions remain valid until logout or expiry.
create table if not exists game_runtime.revoked_sessions (
  digest text primary key,
  expires bigint not null
);
create index if not exists revoked_session_expiry on game_runtime.revoked_sessions(expires);
alter table game_runtime.revoked_sessions enable row level security;
revoke all on game_runtime.revoked_sessions from public, anon, authenticated;
