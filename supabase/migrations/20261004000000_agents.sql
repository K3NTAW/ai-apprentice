-- 20261004000000_agents.sql
-- Agents wave A1: agents as first-class objects, and sessions linked to an agent.
-- Rollback: supabase/rollbacks/20261004000000_agents.down.sql
-- Never edit this file once applied. Later changes go in a new migration.
--
-- Same-workspace linkage (A1): sessions (workspace_id, agent_id) references
-- agents (workspace_id, id), so a session can only point at an agent of its own workspace.
-- The foreign key uses the column list form of on delete set null (Postgres 15+).
--
-- Agent delete (A4): sessions keep their history; their agent_id becomes null.
-- The delete is never blocked by sessions.
--
-- sessions.agent_id rule (A2): set only at insert. After that it may only change to null
-- (the on delete set null path, or a writer detaching it). Setting it from null to an
-- agent, or switching it to another agent, raises 42501.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- avatar follows the AVATAR CONTRACT (AvatarSchema in src/lib/types.ts); the API validates it.
create table public.agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  role text not null check (char_length(role) between 1 and 80),
  expert_name text check (expert_name is null or char_length(expert_name) <= 80),
  avatar jsonb not null check (jsonb_typeof(avatar) = 'object'),
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agents_workspace_id_id_key unique (workspace_id, id)
);

create index agents_workspace_created_idx on public.agents (workspace_id, created_at desc);

alter table public.sessions add column agent_id uuid;

alter table public.sessions
  add constraint sessions_agent_fkey
  foreign key (workspace_id, agent_id) references public.agents (workspace_id, id)
  on delete set null (agent_id);

create index sessions_workspace_agent_idx on public.sessions (workspace_id, agent_id);

-- ---------------------------------------------------------------------------
-- Table grants
-- ---------------------------------------------------------------------------

revoke all on table public.agents from public, anon;
grant select, insert, update, delete on table public.agents to authenticated;

-- ---------------------------------------------------------------------------
-- Trigger functions and triggers
-- Every comparison is null-safe (is distinct from).
-- ---------------------------------------------------------------------------

-- Replaces the init version: same rules plus the agent_id rule above. search_path stays ''.
create or replace function public.sessions_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'sessions.id cannot change' using errcode = '42501';
  end if;
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'sessions.workspace_id cannot change' using errcode = '42501';
  end if;
  -- The only allowed change of created_by is to null without a user JWT
  -- (the on delete set null path when an auth user is deleted).
  if new.created_by is distinct from old.created_by
     and not (new.created_by is null and auth.uid() is null) then
    raise exception 'sessions.created_by cannot change' using errcode = '42501';
  end if;
  -- agent_id may only change to null (agent deleted, or detached).
  if new.agent_id is distinct from old.agent_id and new.agent_id is not null then
    raise exception 'sessions.agent_id cannot change' using errcode = '42501';
  end if;
  return new;
end
$$;

create function public.agents_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'agents.id cannot change' using errcode = '42501';
  end if;
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'agents.workspace_id cannot change' using errcode = '42501';
  end if;
  -- As in sessions: created_by only changes to null without a user JWT.
  if new.created_by is distinct from old.created_by
     and not (new.created_by is null and auth.uid() is null) then
    raise exception 'agents.created_by cannot change' using errcode = '42501';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'agents.created_at cannot change' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger agents_guard_update_trg
  before update on public.agents
  for each row execute function public.agents_guard_update();

create function public.agents_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger agents_touch_updated_at_trg
  before update on public.agents
  for each row execute function public.agents_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------

revoke all on function public.sessions_guard_update() from public, anon, authenticated;
revoke all on function public.agents_guard_update() from public, anon, authenticated;
revoke all on function public.agents_touch_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- Every policy is to authenticated. Every update policy has with check equal to using.
-- ---------------------------------------------------------------------------

alter table public.agents enable row level security;

create policy agents_select on public.agents
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy agents_insert on public.agents
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.workspace_role(workspace_id) in ('owner', 'expert')
  );

create policy agents_update on public.agents
  for update to authenticated
  using (public.workspace_role(workspace_id) in ('owner', 'expert'))
  with check (public.workspace_role(workspace_id) in ('owner', 'expert'));

create policy agents_delete on public.agents
  for delete to authenticated
  using (public.workspace_role(workspace_id) = 'owner');
