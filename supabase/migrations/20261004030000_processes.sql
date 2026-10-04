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
-- process_versions is append-only: every change of a process Work Map adds a row. Only the on delete set null
-- paths (changed_by when an auth user is deleted, source_session_id when a session is deleted) may update it.
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
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint processes_workspace_id_id_key unique (workspace_id, id),
  constraint processes_agent_fkey foreign key (workspace_id, agent_id)
    references public.agents (workspace_id, id) on delete cascade
);

create index processes_workspace_agent_idx on public.processes (workspace_id, agent_id, created_at desc);

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
grant select, insert, update, delete on table public.processes to authenticated;
grant select, insert, delete on table public.process_versions to authenticated;

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

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------

revoke all on function public.processes_guard_update() from public, anon, authenticated;
revoke all on function public.processes_touch_updated_at() from public, anon, authenticated;
revoke all on function public.process_versions_guard_update() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- Every policy is to authenticated. Every update policy has with check equal to using.
-- Members read; owners and experts write; only owners delete.
-- ---------------------------------------------------------------------------

alter table public.processes enable row level security;
alter table public.process_versions enable row level security;

create policy processes_select on public.processes
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy processes_insert on public.processes
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.workspace_role(workspace_id) in ('owner', 'expert')
  );

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

create policy process_versions_insert on public.process_versions
  for insert to authenticated
  with check (
    changed_by = auth.uid()
    and public.workspace_role(workspace_id) in ('owner', 'expert')
  );

create policy process_versions_delete on public.process_versions
  for delete to authenticated
  using (public.workspace_role(workspace_id) = 'owner');
