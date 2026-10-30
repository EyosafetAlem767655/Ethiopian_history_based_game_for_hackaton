alter table game_runtime.gathering_sessions add column if not exists revision bigint not null default 0;
alter table game_runtime.gathering_sessions add column if not exists upload_path text;
alter table game_runtime.gathering_sessions add column if not exists upload_expires bigint not null default 0;
alter table game_runtime.age_reviews add column if not exists upload_path text;
alter table game_runtime.age_reviews add column if not exists upload_expires bigint not null default 0;
create table if not exists game_runtime.media_deletions(
  bucket text not null check(bucket in ('gatherings','age-evidence')), path text not null,
  next_attempt bigint not null, attempts integer not null default 0, primary key(bucket,path)
);
alter table game_runtime.media_deletions enable row level security;
revoke all on game_runtime.media_deletions from public, anon, authenticated;
create or replace function public.pending_media_deletions() returns table(bucket text,path text)
language sql security definer set search_path=pg_catalog as $$
  select d.bucket,d.path from game_runtime.media_deletions d where d.next_attempt<=extract(epoch from clock_timestamp())*1000 order by d.next_attempt limit 100;
$$;
create or replace function public.ack_media_deletion(p_bucket text,p_path text) returns void
language sql security definer set search_path=pg_catalog as $$
  delete from game_runtime.media_deletions where bucket=p_bucket and path=p_path and next_attempt<=extract(epoch from clock_timestamp())*1000;
$$;
revoke all on function public.pending_media_deletions() from public,anon,authenticated;
revoke all on function public.ack_media_deletion(text,text) from public,anon,authenticated;
grant execute on function public.pending_media_deletions() to service_role;
grant execute on function public.ack_media_deletion(text,text) to service_role;
