-- Additive: preserve 001/002 and their auth-only tables. Runtime authority lives in a private schema.
create schema if not exists game_runtime;
revoke all on schema game_runtime from public, anon, authenticated;
create table if not exists game_runtime.secrets(id text primary key,value text not null);
create table if not exists game_runtime.profiles(id text primary key,name text not null,demo integer not null,hero integer not null default 0,progress text not null);
create table if not exists game_runtime.results(id text primary key,demo integer not null,payload text not null,hash text not null,created text not null);
create table if not exists game_runtime.participants(match_id text not null,player_id text not null,primary key(match_id,player_id));
create table if not exists game_runtime.badges(player_id text not null,badge text not null,match_id text not null,primary key(player_id,badge));
create table if not exists game_runtime.outbox(match_id text primary key,status text not null,attempts integer not null default 0,tx text,error text);
create table if not exists game_runtime.squads(id text primary key,code text unique not null,name text not null,demo integer not null,members text not null,rating integer not null default 1000,wins integer not null default 0);
create table if not exists game_runtime.gatherings(id text primary key,squad_id text not null,approvals text not null,simulated integer not null,hash text not null);
create table if not exists game_runtime.campaign_progress(player_id text primary key,data text not null);
-- Canonical game IDs are independent from auth IDs; legacy mappings backfill on first sign-in.
create table if not exists game_runtime.hosted_identities(id text primary key,auth_id uuid unique references auth.users(id) on delete cascade);
create table if not exists game_runtime.hosted_outbox(match_id text primary key,status text not null default 'pending',error text);
create table if not exists game_runtime.gathering_sessions(id text primary key,squad_id text not null,path text,approvals text not null default '[]',verified integer not null default 0,created bigint not null default 0);
create table if not exists game_runtime.wallets(player_id text primary key,address text unique not null);
create table if not exists game_runtime.wallet_nonces(player_id text primary key,nonce text not null,expires bigint not null);
create table if not exists game_runtime.avatars(player_id text primary key,data text not null);
create table if not exists game_runtime.age_reviews(id text primary key,player_id text not null,status text not null,path text,birth_date text,created bigint not null,expires bigint not null,reviewer text,reviewed bigint);
create unique index if not exists one_pending_review on game_runtime.age_reviews(player_id) where status='pending';
create index if not exists age_review_player on game_runtime.age_reviews(player_id,created desc);
create index if not exists participant_player on game_runtime.participants(player_id);
create or replace function game_runtime.safe_rating(value text) returns numeric language plpgsql immutable set search_path=pg_catalog as $$
declare j jsonb; begin j:=value::jsonb; if jsonb_typeof(j->'rating')='number' then return (j->>'rating')::numeric; end if; return 1000; exception when others then return 1000; end $$;
do $$ declare t text; begin
 for t in select tablename from pg_tables where schemaname='game_runtime' loop
 execute format('alter table game_runtime.%I enable row level security',t);
 execute format('revoke all on game_runtime.%I from public,anon,authenticated',t);
 end loop; end $$;
revoke all on all functions in schema game_runtime from public,anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('age-evidence','age-evidence',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
-- Do NOT expose game_runtime in the Data API. Backend uses its private database pooler connection.
-- Keep existing public tables as legacy records; new game reads/writes use game_runtime exclusively.

-- Preserve existing hosted records. These copies never overwrite newer runtime rows.
insert into game_runtime.profiles(id,name,demo,hero,progress)
select p.id::text,p.nickname,0,p.hero,coalesce(pp.progress,'{}'::jsonb)::text from public.profiles p
left join public.player_progression pp on pp.player_id=p.id on conflict do nothing;
insert into game_runtime.hosted_identities(id,auth_id) select id::text,id from public.profiles on conflict do nothing;
insert into game_runtime.campaign_progress(player_id,data) select player_id::text,data::text from public.campaign_progress on conflict do nothing;
insert into game_runtime.results(id,demo,payload,hash,created)
select match_id,case when payload->>'demo'='true' then 1 else 0 end,payload::text,result_hash,coalesce(payload->>'endedAt',created_at::text) from public.match_results on conflict do nothing;
insert into game_runtime.participants select match_id,player_id::text from public.match_participants on conflict do nothing;
insert into game_runtime.badges select player_id::text,achievement_id,source_id from public.player_achievements on conflict do nothing;
insert into game_runtime.outbox(match_id,status,attempts,tx) select match_id,status,attempts,transaction_hash from public.blockchain_attestations on conflict do nothing;
insert into game_runtime.wallets select player_id::text,address from public.wallet_identities on conflict do nothing;
insert into game_runtime.squads(id,code,name,demo,members,rating,wins)
select s.id::text,s.invite_code,s.name,0,coalesce((select jsonb_agg(m.player_id::text order by m.slot)::text from public.squad_members m where m.squad_id=s.id),'[]'),s.rating,s.wins from public.squads s on conflict do nothing;
insert into game_runtime.gathering_sessions(id,squad_id,path,approvals,verified,created)
select v.id::text,v.squad_id::text,v.object_path,coalesce((select jsonb_agg(a.player_id::text)::text from public.lunch_approvals a where a.session_id=v.id),'[]'),case when v.verified_at is null then 0 else 1 end,coalesce(extract(epoch from v.verified_at)*1000,0)::bigint
from public.lunch_verification_sessions v where not v.simulated on conflict do nothing;
