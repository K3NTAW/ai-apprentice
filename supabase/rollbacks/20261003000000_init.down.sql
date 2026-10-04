-- 20261003000000_init.down.sql
-- Rollback for supabase/migrations/20261003000000_init.sql
--
-- WARNING: this deletes all app data (workspaces, members, invites, sessions and every
-- session child row). It is NOT a data backup. Take a backup first if the data matters.
--
-- The frames bucket and its objects stay. They are retained user data until they are
-- emptied and removed through the dashboard or the Storage API, which is required for
-- deletion requests. This file never writes to the storage bucket or object tables
-- (hosted Supabase blocks SQL deletes there).
--
-- When the migration was applied with supabase db push, also run
--   supabase migration repair --status reverted 20261003000000
-- or the CLI believes it is still applied. Re-applying the migration with the bucket
-- still present works because of the on conflict clause on the bucket insert.
--
-- Safe to run twice. Order: storage policies first (storage.objects always exists),
-- then the public policies and triggers inside a guard that skips a table that no
-- longer exists, then the tables children first with drop table if exists ... cascade
-- as the backstop that removes any policy or trigger left on them, then the functions.
-- A second run finds nothing and only raises notices.

-- ---------------------------------------------------------------------------
-- Storage policies
-- ---------------------------------------------------------------------------

drop policy if exists frames_objects_select on storage.objects;
drop policy if exists frames_objects_insert on storage.objects;
drop policy if exists frames_objects_update on storage.objects;
drop policy if exists frames_objects_delete on storage.objects;

-- ---------------------------------------------------------------------------
-- Public policies and triggers (guarded per table so a second run is clean)
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.session_frames') is not null then
    drop policy if exists session_frames_select on public.session_frames;
    drop policy if exists session_frames_insert on public.session_frames;
    drop policy if exists session_frames_update on public.session_frames;
    drop policy if exists session_frames_delete on public.session_frames;
    drop trigger if exists session_frames_guard_update_trg on public.session_frames;
  end if;

  if to_regclass('public.session_qa') is not null then
    drop policy if exists session_qa_select on public.session_qa;
    drop policy if exists session_qa_insert on public.session_qa;
    drop policy if exists session_qa_update on public.session_qa;
    drop policy if exists session_qa_delete on public.session_qa;
    drop trigger if exists session_qa_guard_update_trg on public.session_qa;
  end if;

  if to_regclass('public.session_transcript') is not null then
    drop policy if exists session_transcript_select on public.session_transcript;
    drop policy if exists session_transcript_insert on public.session_transcript;
    drop policy if exists session_transcript_update on public.session_transcript;
    drop policy if exists session_transcript_delete on public.session_transcript;
    drop trigger if exists session_transcript_guard_update_trg on public.session_transcript;
  end if;

  if to_regclass('public.session_events') is not null then
    drop policy if exists session_events_select on public.session_events;
    drop policy if exists session_events_insert on public.session_events;
    drop policy if exists session_events_update on public.session_events;
    drop policy if exists session_events_delete on public.session_events;
    drop trigger if exists session_events_guard_update_trg on public.session_events;
  end if;

  if to_regclass('public.sessions') is not null then
    drop policy if exists sessions_select on public.sessions;
    drop policy if exists sessions_insert on public.sessions;
    drop policy if exists sessions_update on public.sessions;
    drop policy if exists sessions_delete on public.sessions;
    drop trigger if exists sessions_guard_update_trg on public.sessions;
  end if;

  if to_regclass('public.workspace_invites') is not null then
    drop policy if exists workspace_invites_select on public.workspace_invites;
    drop policy if exists workspace_invites_insert on public.workspace_invites;
    drop policy if exists workspace_invites_delete on public.workspace_invites;
  end if;

  if to_regclass('public.workspace_members') is not null then
    drop policy if exists workspace_members_select on public.workspace_members;
    drop policy if exists workspace_members_update on public.workspace_members;
    drop policy if exists workspace_members_delete on public.workspace_members;
    drop trigger if exists workspace_members_last_owner_guard_trg on public.workspace_members;
    drop trigger if exists workspace_members_guard_update_trg on public.workspace_members;
  end if;

  if to_regclass('public.workspaces') is not null then
    drop policy if exists workspaces_select on public.workspaces;
    drop policy if exists workspaces_update on public.workspaces;
    drop policy if exists workspaces_delete on public.workspaces;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Tables, children first
-- ---------------------------------------------------------------------------

drop table if exists public.session_frames cascade;
drop table if exists public.session_qa cascade;
drop table if exists public.session_transcript cascade;
drop table if exists public.session_events cascade;
drop table if exists public.sessions cascade;
drop table if exists public.workspace_invites cascade;
drop table if exists public.workspace_members cascade;
drop table if exists public.workspaces cascade;

-- ---------------------------------------------------------------------------
-- Functions, exact signatures
-- ---------------------------------------------------------------------------

drop function if exists public.bootstrap_workspace();
drop function if exists public.session_frame_prefix(text);
drop function if exists public.can_write_session(text);
drop function if exists public.can_read_session(text);
drop function if exists public.workspace_role(uuid);
drop function if exists public.is_workspace_member_text(text);
drop function if exists public.is_workspace_member(uuid);
drop function if exists public.session_child_guard_update();
drop function if exists public.workspace_members_last_owner_guard();
drop function if exists public.workspace_members_guard_update();
drop function if exists public.sessions_guard_update();

-- ---------------------------------------------------------------------------
-- Verification: run after the rollback. Expects 0 rows.
-- Lists leftover policies, triggers, functions and tables created by the migration.
-- ---------------------------------------------------------------------------

select 'policy' as kind, p.schemaname || '.' || p.tablename || '.' || p.policyname as object
from pg_catalog.pg_policies p
where (p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname in (
         'frames_objects_select', 'frames_objects_insert',
         'frames_objects_update', 'frames_objects_delete'))
   or (p.schemaname = 'public' and p.tablename in (
         'workspaces', 'workspace_members', 'workspace_invites', 'sessions',
         'session_events', 'session_transcript', 'session_qa', 'session_frames'))
union all
select 'trigger', c.relname || '.' || t.tgname
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and not t.tgisinternal
  and t.tgname in (
    'sessions_guard_update_trg', 'workspace_members_guard_update_trg',
    'workspace_members_last_owner_guard_trg', 'session_events_guard_update_trg',
    'session_transcript_guard_update_trg', 'session_qa_guard_update_trg',
    'session_frames_guard_update_trg')
union all
select 'function', n.nspname || '.' || f.proname
from pg_catalog.pg_proc f
join pg_catalog.pg_namespace n on n.oid = f.pronamespace
where n.nspname = 'public'
  and f.proname in (
    'is_workspace_member', 'is_workspace_member_text', 'workspace_role',
    'can_read_session', 'can_write_session', 'session_frame_prefix',
    'bootstrap_workspace', 'sessions_guard_update', 'workspace_members_guard_update',
    'workspace_members_last_owner_guard', 'session_child_guard_update')
union all
select 'table', t.schemaname || '.' || t.tablename
from pg_catalog.pg_tables t
where t.schemaname = 'public'
  and t.tablename in (
    'workspaces', 'workspace_members', 'workspace_invites', 'sessions',
    'session_events', 'session_transcript', 'session_qa', 'session_frames');
