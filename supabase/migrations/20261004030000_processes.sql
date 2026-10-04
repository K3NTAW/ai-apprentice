-- 20261004030000_processes.sql
-- Processes slice (a): processes as real, editable objects with a version history, and sessions linked to one.
-- Rollback: supabase/rollbacks/20261004030000_processes.down.sql
-- Never edit this file once applied. Later changes go in a new migration.
--
-- Same-workspace linkage: processes (workspace_id, agent_id) references agents (workspace_id, id), versions
-- (workspace_id, process_id) references processes (workspace_id, id), and sessions (workspace_id, process_id)
-- references processes (workspace_id, id). A process goes with its agent (on delete cascade), versions go with
-- their process, and a session keeps its history when its process is deleted (process_id becomes null).
--
-- process_versions is append-only: every change of a process Work Map adds a row. No insert, update or delete
-- grant or policy for anyone: rows are written only inside create_process and update_process and go only with
-- their process (on delete cascade). Only the on delete set null paths (changed_by when an auth user is deleted,
-- source_session_id when a session is deleted) may update it.
--
-- Writes: public.create_process (process, version 1 and the session link in one transaction), public.update_process
-- (Work Map, title and archive in one call; a version row only for a Work Map change), delete (owners) through
-- PostgREST. update_process checks the expected version of a Work Map change (optimistic concurrency, PT409 =
-- HTTP 409). Archive and restore are owner only (update_process and processes_guard_update). confirmed always
-- equals the Work Map's confirmed_by_expert (processes_confirmed_derived). Both functions validate the Work Map
-- with public.workmap_valid (required keys and types, size cap) and raise 22023 otherwise.
--
-- Backfill: processes.source_session_id is unique where not null, and create_process inserts with on conflict do
-- nothing, so two concurrent backfills create each process once (the loser gets 23505 'process_exists'). A
-- backfilled process keeps its session's started_at as created_at, so the order is unchanged.
--
-- A session links to at most one process: create_process and update_process link p_source_session only when its
-- process_id is null or already the process (else PT409 'session_linked'). An update_process call with nothing to
-- change raises 22023 'nothing to update' (HTTP 400).
--
-- Deleted processes stay deleted: processes_tombstones_trg records the source session of every deleted process in
-- public.processes_tombstones, and create_process with p_backfill raises 23505 'process_deleted' for a recorded
-- session, so the next backfill skips it. Members read tombstones; only the trigger writes them.
--
-- Until this migration is applied the API answers 503 'processes not available yet', never 500.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.processes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  agent_id uuid not null,
  title text not null check (char_length(title) between 1 and 120),
  workmap jsonb not null check (jsonb_typeof(workmap) = 'object'),
  version int not null default 1 check (version >= 1),
  confirmed boolean not null default false,
  archived_at timestamptz,
  source_session_id text references public.sessions on delete set null,
  constraint processes_confirmed_derived check (confirmed = coalesce(workmap -> 'confirmed_by_expert' = 'true'::jsonb, false)),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint processes_workspace_id_id_key unique (workspace_id, id),
  constraint processes_agent_fkey foreign key (workspace_id, agent_id)
    references public.agents (workspace_id, id) on delete cascade
);

create index processes_workspace_agent_idx on public.processes (workspace_id, agent_id, created_at desc);

-- One process per source session: the conflict target of create_process.
create unique index processes_source_session_key on public.processes (source_session_id) where source_session_id is not null;

create table public.process_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  process_id uuid not null,
  version int not null check (version >= 1),
  workmap jsonb not null check (jsonb_typeof(workmap) = 'object'),
  source_session_id text references public.sessions on delete set null,
  change_kind text not null check (change_kind in ('trained', 'extended', 'replaced', 'edited')),
  changed_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  constraint process_versions_process_version_key unique (process_id, version),
  constraint process_versions_process_fkey foreign key (workspace_id, process_id)
    references public.processes (workspace_id, id) on delete cascade
);

-- Source sessions of deleted processes. Written only by processes_tombstones_trg (security definer).
create table public.processes_tombstones (
  source_session_id text primary key references public.sessions on delete cascade,
  workspace_id uuid not null references public.workspaces on delete cascade,
  deleted_at timestamptz not null default now()
);

create index processes_tombstones_workspace_idx on public.processes_tombstones (workspace_id);

alter table public.sessions add column process_id uuid;

alter table public.sessions
  add constraint sessions_process_fkey
  foreign key (workspace_id, process_id) references public.processes (workspace_id, id)
  on delete set null (process_id);

create index sessions_workspace_process_idx on public.sessions (workspace_id, process_id);

-- ---------------------------------------------------------------------------
-- Table grants
-- ---------------------------------------------------------------------------

revoke all on table public.processes from public, anon;
revoke all on table public.process_versions from public, anon;
revoke all on table public.processes_tombstones from public, anon;
grant select, delete on table public.processes to authenticated;
grant update (title, archived_at) on table public.processes to authenticated;
grant select on table public.process_versions to authenticated;
grant select on table public.processes_tombstones to authenticated;

-- ---------------------------------------------------------------------------
-- Trigger functions and triggers
-- Every comparison is null-safe (is distinct from).
-- ---------------------------------------------------------------------------

create function public.processes_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'processes.id cannot change' using errcode = '42501';
  end if;
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'processes.workspace_id cannot change' using errcode = '42501';
  end if;
  if new.agent_id is distinct from old.agent_id then
    raise exception 'processes.agent_id cannot change' using errcode = '42501';
  end if;
  -- As in sessions and agents: created_by only changes to null without a user JWT.
  if new.created_by is distinct from old.created_by
     and not (new.created_by is null and auth.uid() is null) then
    raise exception 'processes.created_by cannot change' using errcode = '42501';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'processes.created_at cannot change' using errcode = '42501';
  end if;
  -- Only on delete set null of the session may clear it.
  if new.source_session_id is distinct from old.source_session_id and new.source_session_id is not null then
    raise exception 'processes.source_session_id cannot change' using errcode = '42501';
  end if;
  -- Archive and restore are owner actions. Without a user JWT (service role) it is allowed.
  if new.archived_at is distinct from old.archived_at
     and auth.uid() is not null
     and public.workspace_role(old.workspace_id) is distinct from 'owner' then
    raise exception 'only owners archive or restore a process' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger processes_guard_update_trg
  before update on public.processes
  for each row execute function public.processes_guard_update();

create function public.processes_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger processes_touch_updated_at_trg
  before update on public.processes
  for each row execute function public.processes_touch_updated_at();

create function public.process_versions_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.process_id is distinct from old.process_id
     or new.version is distinct from old.version
     or new.workmap is distinct from old.workmap
     or new.change_kind is distinct from old.change_kind
     or new.created_at is distinct from old.created_at then
    raise exception 'process_versions rows cannot change' using errcode = '42501';
  end if;
  if new.changed_by is distinct from old.changed_by
     and not (new.changed_by is null and auth.uid() is null) then
    raise exception 'process_versions.changed_by cannot change' using errcode = '42501';
  end if;
  if new.source_session_id is distinct from old.source_session_id and new.source_session_id is not null then
    raise exception 'process_versions.source_session_id cannot change' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger process_versions_guard_update_trg
  before update on public.process_versions
  for each row execute function public.process_versions_guard_update();

-- Records the source session of a deleted process (delete by an owner, or the cascade from its agent). Skipped when
-- the session or the workspace goes in the same statement (workspace delete), so the tombstone never dangles.
create function public.processes_tombstone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.source_session_id is not null
     and exists (select 1 from public.sessions s where s.id = old.source_session_id)
     and exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    insert into public.processes_tombstones (source_session_id, workspace_id)
    values (old.source_session_id, old.workspace_id)
    on conflict (source_session_id) do nothing;
  end if;
  return old;
end
$$;

create trigger processes_tombstones_trg
  after delete on public.processes
  for each row execute function public.processes_tombstone();

-- ---------------------------------------------------------------------------
-- workmap_valid: the database-level shape check of a Work Map (mirrors the required part of WorkMapSchema in
-- src/lib/types.ts). Top level: task and expert strings, confirmed_by_expert boolean, steps and open_questions
-- arrays, shortcuts an array when present. Each step: an object with n number, title string, decision string,
-- is_judgment_call boolean, screen_moment object, guardrails array and scores object. At most 200 steps and
-- 256 KiB of JSON text.
-- ---------------------------------------------------------------------------

create function public.workmap_valid(p_workmap jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  st jsonb;
begin
  if p_workmap is null or jsonb_typeof(p_workmap) is distinct from 'object' then
    return false;
  end if;
  if octet_length(p_workmap::text) > 262144 then
    return false;
  end if;
  if jsonb_typeof(p_workmap -> 'task') is distinct from 'string'
     or jsonb_typeof(p_workmap -> 'expert') is distinct from 'string'
     or jsonb_typeof(p_workmap -> 'confirmed_by_expert') is distinct from 'boolean'
     or jsonb_typeof(p_workmap -> 'steps') is distinct from 'array'
     or jsonb_typeof(p_workmap -> 'open_questions') is distinct from 'array'
     or (p_workmap ? 'shortcuts' and jsonb_typeof(p_workmap -> 'shortcuts') is distinct from 'array') then
    return false;
  end if;
  if jsonb_array_length(p_workmap -> 'steps') > 200 then
    return false;
  end if;
  for st in select value from jsonb_array_elements(p_workmap -> 'steps') loop
    if jsonb_typeof(st) is distinct from 'object'
       or jsonb_typeof(st -> 'n') is distinct from 'number'
       or jsonb_typeof(st -> 'title') is distinct from 'string'
       or jsonb_typeof(st -> 'decision') is distinct from 'string'
       or jsonb_typeof(st -> 'is_judgment_call') is distinct from 'boolean'
       or jsonb_typeof(st -> 'screen_moment') is distinct from 'object'
       or jsonb_typeof(st -> 'guardrails') is distinct from 'array'
       or jsonb_typeof(st -> 'scores') is distinct from 'object' then
      return false;
    end if;
  end loop;
  return true;
end
$$;

-- ---------------------------------------------------------------------------
-- create_process: the only way to create a process. Security definer so it can write the version row (no insert
-- grant on process_versions) and link the source session. It checks the caller's role itself: owner or expert;
-- p_backfill (created_at = the source session's started_at) is owner only.
-- On conflict (source_session_id) do nothing: a second process for the same source session is never created;
-- the caller gets 23505 'process_exists' and nothing is written. A backfill for a session in processes_tombstones
-- raises 23505 'process_deleted'. A source session linked to another process raises PT409 'session_linked'.
-- ---------------------------------------------------------------------------

create function public.create_process(
  p_workspace_id uuid,
  p_agent_id uuid,
  p_title text,
  p_workmap jsonb,
  p_source_session text default null,
  p_backfill boolean default false
)
returns public.processes
language plpgsql
security definer
set search_path = ''
as $$
declare
  src_started timestamptz;
  nxt public.processes;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.workspace_role(p_workspace_id) is distinct from 'owner'
     and public.workspace_role(p_workspace_id) is distinct from 'expert' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if coalesce(p_backfill, false) and public.workspace_role(p_workspace_id) is distinct from 'owner' then
    raise exception 'only owners backfill processes' using errcode = '42501';
  end if;
  if coalesce(p_backfill, false) and p_source_session is null then
    raise exception 'backfill needs a source session' using errcode = '22023';
  end if;
  if not public.workmap_valid(p_workmap) then
    raise exception 'invalid workmap' using errcode = '22023';
  end if;
  if not exists (select 1 from public.agents a where a.id = p_agent_id and a.workspace_id = p_workspace_id) then
    raise exception 'agent not found' using errcode = 'P0002';
  end if;
  if p_source_session is not null then
    select s.started_at into src_started from public.sessions s
     where s.id = p_source_session and s.workspace_id = p_workspace_id;
    if not found then
      raise exception 'session not found' using errcode = 'P0002';
    end if;
  end if;
  if coalesce(p_backfill, false) and exists (
    select 1 from public.processes_tombstones t where t.source_session_id = p_source_session
  ) then
    raise exception 'process_deleted' using errcode = '23505';
  end if;
  insert into public.processes (workspace_id, agent_id, title, workmap, version, confirmed, created_by, source_session_id, created_at, updated_at)
  values (
    p_workspace_id, p_agent_id, p_title, p_workmap, 1,
    coalesce(p_workmap -> 'confirmed_by_expert' = 'true'::jsonb, false),
    auth.uid(), p_source_session,
    case when coalesce(p_backfill, false) then src_started else now() end,
    now()
  )
  on conflict (source_session_id) where source_session_id is not null do nothing
  returning * into nxt;
  if not found then
    raise exception 'process_exists' using errcode = '23505';
  end if;
  insert into public.process_versions (workspace_id, process_id, version, workmap, source_session_id, change_kind, changed_by)
  values (nxt.workspace_id, nxt.id, 1, nxt.workmap, p_source_session, 'trained', auth.uid());
  if p_source_session is not null then
    -- Never take a session from another process; the raise rolls back the insert.
    update public.sessions set process_id = nxt.id
     where id = p_source_session and workspace_id = nxt.workspace_id and process_id is null;
    if not found then
      raise exception 'session_linked' using errcode = 'PT409';
    end if;
  end if;
  return nxt;
end
$$;

-- ---------------------------------------------------------------------------
-- update_process: the only way to change a process Work Map, and the one call for a combined change.
-- Security definer so it can write workmap, version and confirmed (not granted to authenticated) and the
-- version row (no insert grant on process_versions). It checks the caller's role itself.
-- A non-null p_workmap must be at p_expected_version (else PT409) and adds a version row; p_title renames;
-- p_archived archives (true) or restores (false), owner only. Title or archive alone add no version row and skip
-- the version check. p_source_session links that session to the process, only when it is not linked or already
-- linked to this process (else PT409 'session_linked'). Nothing to change raises 22023 'nothing to update'.
-- ---------------------------------------------------------------------------

create function public.update_process(
  p_id uuid,
  p_expected_version int,
  p_workmap jsonb,
  p_change_kind text,
  p_source_session text,
  p_title text default null,
  p_archived boolean default null
)
returns public.processes
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur public.processes;
  nxt public.processes;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into cur from public.processes where id = p_id;
  if not found or not public.is_workspace_member(cur.workspace_id) then
    raise exception 'process not found' using errcode = 'P0002';
  end if;
  if public.workspace_role(cur.workspace_id) is distinct from 'owner'
     and public.workspace_role(cur.workspace_id) is distinct from 'expert' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_archived is not null and public.workspace_role(cur.workspace_id) is distinct from 'owner' then
    raise exception 'only owners archive or restore a process' using errcode = '42501';
  end if;
  if p_workmap is null and p_title is null and p_archived is null and p_source_session is null then
    raise exception 'nothing to update' using errcode = '22023';
  end if;
  if p_workmap is not null and not public.workmap_valid(p_workmap) then
    raise exception 'invalid workmap' using errcode = '22023';
  end if;
  if p_source_session is not null and not exists (
    select 1 from public.sessions s where s.id = p_source_session and s.workspace_id = cur.workspace_id
  ) then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  if p_source_session is not null and exists (
    select 1 from public.sessions s
     where s.id = p_source_session and s.process_id is not null and s.process_id is distinct from p_id
  ) then
    raise exception 'session_linked' using errcode = 'PT409';
  end if;
  update public.processes
     set workmap = coalesce(p_workmap, workmap),
         version = case when p_workmap is null then version else version + 1 end,
         confirmed = case when p_workmap is null then confirmed
                          else coalesce(p_workmap -> 'confirmed_by_expert' = 'true'::jsonb, false) end,
         title = coalesce(p_title, title),
         archived_at = case when p_archived is null then archived_at
                            when p_archived then coalesce(archived_at, now())
                            else null end
   where id = p_id and (p_workmap is null or version = p_expected_version)
  returning * into nxt;
  if not found then
    raise exception 'process_version_conflict' using errcode = 'PT409';
  end if;
  if p_workmap is not null then
    insert into public.process_versions (workspace_id, process_id, version, workmap, source_session_id, change_kind, changed_by)
    values (nxt.workspace_id, nxt.id, nxt.version, nxt.workmap, p_source_session, coalesce(p_change_kind, 'edited'), auth.uid());
  end if;
  if p_source_session is not null then
    -- Re-checked in the update: a concurrent link to another process rolls this call back.
    update public.sessions set process_id = nxt.id
     where id = p_source_session and workspace_id = nxt.workspace_id
       and (process_id is null or process_id = nxt.id);
    if not found then
      raise exception 'session_linked' using errcode = 'PT409';
    end if;
  end if;
  return nxt;
end
$$;

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------

revoke all on function public.processes_guard_update() from public, anon, authenticated;
revoke all on function public.processes_touch_updated_at() from public, anon, authenticated;
revoke all on function public.process_versions_guard_update() from public, anon, authenticated;
revoke all on function public.processes_tombstone() from public, anon, authenticated;
revoke all on function public.workmap_valid(jsonb) from public, anon;
grant execute on function public.workmap_valid(jsonb) to authenticated;
revoke all on function public.create_process(uuid, uuid, text, jsonb, text, boolean) from public, anon;
grant execute on function public.create_process(uuid, uuid, text, jsonb, text, boolean) to authenticated;
revoke all on function public.update_process(uuid, int, jsonb, text, text, text, boolean) from public, anon;
grant execute on function public.update_process(uuid, int, jsonb, text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- Every policy is to authenticated. Every update policy has with check equal to using.
-- Members read; owners and experts update title (archive is owner only, see processes_guard_update); only owners
-- delete processes. No insert policy on either table (inserts go through create_process and update_process);
-- nobody inserts, updates or deletes versions directly. Members read tombstones; nobody writes them directly.
-- ---------------------------------------------------------------------------

alter table public.processes enable row level security;
alter table public.process_versions enable row level security;
alter table public.processes_tombstones enable row level security;

create policy processes_select on public.processes
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy processes_update on public.processes
  for update to authenticated
  using (public.workspace_role(workspace_id) in ('owner', 'expert'))
  with check (public.workspace_role(workspace_id) in ('owner', 'expert'));

create policy processes_delete on public.processes
  for delete to authenticated
  using (public.workspace_role(workspace_id) = 'owner');

create policy process_versions_select on public.process_versions
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy processes_tombstones_select on public.processes_tombstones
  for select to authenticated
  using (public.is_workspace_member(workspace_id));
