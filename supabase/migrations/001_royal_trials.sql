-- Apply using Supabase CLI or the SQL editor. All progression writes are server-only.
create extension if not exists pgcrypto;
create table public.profiles(id uuid primary key references auth.users(id) on delete cascade,nickname text not null check(length(nickname) between 2 and 20),hero integer not null default 0,created_at timestamptz not null default now());
create table public.player_progression(player_id uuid primary key references public.profiles(id),progress jsonb not null default '{}');
create table public.player_stats(player_id uuid primary key references public.profiles(id),stats jsonb not null default '{}');
create table public.wallet_identities(player_id uuid primary key references public.profiles(id),address text not null unique,verified_at timestamptz not null default now());
create table public.character_selections(player_id uuid primary key references public.profiles(id),hero integer not null check(hero between 0 and 3));
create table public.tutorial_progress(player_id uuid primary key references public.profiles(id),completed boolean not null default false);
create table public.squads(id uuid primary key,name text not null,invite_code text unique not null,rating integer not null default 1000,wins integer not null default 0);
create table public.squad_members(squad_id uuid references public.squads(id),player_id uuid references public.profiles(id),slot integer check(slot between 0 and 3),primary key(squad_id,player_id),unique(squad_id,slot));
create table public.squad_invitations(id uuid primary key default gen_random_uuid(),squad_id uuid references public.squads(id),code text unique not null,expires_at timestamptz not null);
create table public.matches(id text primary key,mode text not null,demo boolean not null default false,started_at timestamptz not null,ended_at timestamptz not null);
create table public.match_results(match_id text primary key references public.matches(id),payload jsonb not null,result_hash text not null unique,created_at timestamptz not null default now());
create table public.match_participants(match_id text references public.matches(id),player_id uuid references public.profiles(id),stats jsonb not null,primary key(match_id,player_id));
create table public.match_events(match_id text references public.matches(id),event_index integer not null,event jsonb not null,primary key(match_id,event_index));
create table public.scoring_events(match_id text references public.matches(id),player_id uuid references public.profiles(id),delta jsonb not null,primary key(match_id,player_id));
create table public.achievements(id text primary key,metadata jsonb not null);
create table public.player_achievements(player_id uuid references public.profiles(id),achievement_id text not null,source_id text not null,created_at timestamptz not null default now(),primary key(player_id,achievement_id));
create table public.blockchain_attestations(match_id text primary key references public.matches(id),status text not null,transaction_hash text,attempts integer not null default 0);
create table public.lunch_passes(id uuid primary key,squad_id uuid references public.squads(id),claimed boolean not null default false,redeemed boolean not null default false);
create table public.lunch_verification_sessions(id uuid primary key,squad_id uuid references public.squads(id),object_path text,metadata_hash text,verified_at timestamptz,simulated boolean not null default false);
create table public.lunch_approvals(session_id uuid references public.lunch_verification_sessions(id),player_id uuid references public.profiles(id),approved_at timestamptz not null default now(),primary key(session_id,player_id));
create table public.quest_progress(squad_id uuid primary key references public.squads(id),progress jsonb not null default '{}');
create table public.chat_messages(id uuid primary key default gen_random_uuid(),squad_id uuid references public.squads(id),player_id uuid references public.profiles(id),message text not null check(length(message) between 1 and 200),created_at timestamptz not null default now());
create index match_participants_player on public.match_participants(player_id);
create index profiles_created on public.profiles(created_at);
create index chat_messages_squad on public.chat_messages(squad_id,created_at);
create view public.leaderboard with (security_invoker=true) as select p.id,p.nickname,(pp.progress->>'rating')::integer rating,pp.progress from public.profiles p join public.player_progression pp on pp.player_id=p.id;
do $$ declare t text; begin
 foreach t in array array['profiles','player_progression','player_stats','wallet_identities','character_selections','tutorial_progress','squads','squad_members','squad_invitations','matches','match_results','match_participants','match_events','scoring_events','achievements','player_achievements','blockchain_attestations','lunch_passes','lunch_verification_sessions','lunch_approvals','quest_progress','chat_messages'] loop
 execute format('alter table public.%I enable row level security',t);
 end loop;
end $$;
create policy own_profile on public.profiles for select to authenticated using(id=auth.uid());
create policy own_progression on public.player_progression for select to authenticated using(player_id=auth.uid());
create policy own_wallet on public.wallet_identities for select to authenticated using(player_id=auth.uid());
create policy own_achievements on public.player_achievements for select to authenticated using(player_id=auth.uid());
-- No client INSERT/UPDATE/DELETE policies. Trusted backend uses the service role.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('gatherings','gatherings',false,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
-- Private storage accessed exclusively through short-lived server-generated URLs.
create or replace function public.commit_match(p_id text,p_payload jsonb,p_hash text,p_players jsonb,p_badges jsonb,p_status text) returns boolean language plpgsql security definer set search_path=public as $$
declare item jsonb;begin
 insert into matches values(p_id,p_payload->>'mode',false,(p_payload->>'startedAt')::timestamptz,(p_payload->>'endedAt')::timestamptz) on conflict do nothing;
 if exists(select 1 from match_results where match_id=p_id) then return false;end if;
 insert into match_results(match_id,payload,result_hash) values(p_id,p_payload,p_hash);
 for item in select * from jsonb_array_elements(p_players) loop
 insert into profiles(id,nickname,hero) values((item->>'id')::uuid,item->>'name',(item->>'hero')::integer) on conflict(id) do update set nickname=excluded.nickname,hero=excluded.hero;
 insert into player_progression values((item->>'id')::uuid,item->'progress') on conflict(player_id) do update set progress=excluded.progress;
 insert into match_participants values(p_id,(item->>'id')::uuid,item->'stats');
 end loop;
 for item in select * from jsonb_array_elements(p_badges) loop
 insert into player_achievements(player_id,achievement_id,source_id) values((item->>'player_id')::uuid,item->>'badge',item->>'match_id') on conflict do nothing;
 end loop;
 insert into blockchain_attestations(match_id,status) values(p_id,p_status);
 return true;
end $$;
revoke all on function public.commit_match(text,jsonb,text,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.commit_match(text,jsonb,text,jsonb,jsonb,text) to service_role;
