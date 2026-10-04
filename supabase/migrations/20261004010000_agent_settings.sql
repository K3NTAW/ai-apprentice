-- 20261004010000_agent_settings.sql
-- Agent settings (agents.settings), deletion requests and the deletion report.
-- The settings keys, types, ranges and defaults are defined once in src/lib/agents/settings.ts;
-- the CHECK below mirrors it. A missing key means its default.
-- Rollback: supabase/rollbacks/20261004010000_agent_settings.down.sql

-- ---------------------------------------------------------------------------
-- agents.settings
-- ---------------------------------------------------------------------------

alter table public.agents add column settings jsonb not null default '{}'::jsonb;

alter table public.agents
  add constraint agents_settings_check check (
    jsonb_typeof(settings) = 'object'
    and (settings - array[
      'question_interval_s', 'guardrails_first', 'learn_shortcuts', 'voice_preset', 'voice_speed',
      'redact_names_emails', 'redact_iban_phone', 'off_record_phrase', 'retention_days'
    ]) = '{}'::jsonb
    and case when settings ? 'question_interval_s' then
      case when jsonb_typeof(settings -> 'question_interval_s') = 'number'
        then (settings ->> 'question_interval_s')::numeric in (20, 60, 120, 180, 300) else false end
      else true end
    and (not settings ? 'guardrails_first' or jsonb_typeof(settings -> 'guardrails_first') = 'boolean')
    and (not settings ? 'learn_shortcuts' or jsonb_typeof(settings -> 'learn_shortcuts') = 'boolean')
    and case when settings ? 'voice_preset' then
      case when jsonb_typeof(settings -> 'voice_preset') = 'string'
        then (settings ->> 'voice_preset') in ('calm', 'neutral', 'energetic') else false end
      else true end
    and case when settings ? 'voice_speed' then
      case when jsonb_typeof(settings -> 'voice_speed') = 'number'
        then (settings ->> 'voice_speed')::numeric between 0.8 and 1.2 else false end
      else true end
    and (not settings ? 'redact_names_emails' or jsonb_typeof(settings -> 'redact_names_emails') = 'boolean')
    and (not settings ? 'redact_iban_phone' or jsonb_typeof(settings -> 'redact_iban_phone') = 'boolean')
    and case when settings ? 'off_record_phrase' then
      case when jsonb_typeof(settings -> 'off_record_phrase') = 'string'
        then (settings ->> 'off_record_phrase') ~ '^[[:alnum:]'' -]{1,40}$' else false end
      else true end
    and case when settings ? 'retention_days' then
      case when jsonb_typeof(settings -> 'retention_days') = 'number'
        then (settings ->> 'retention_days')::numeric in (7, 30, 90, 365) else false end
      else true end
  );

-- Merge patch: concurrent saves of different keys never overwrite each other.
-- Security invoker, so the agents_update policy (owner or expert) still decides.
create function public.agent_settings_patch(p_workspace uuid, p_agent uuid, p_patch jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  update public.agents
     set settings = settings || p_patch
   where workspace_id = p_workspace and id = p_agent
  returning settings;
$$;

-- ---------------------------------------------------------------------------
-- agent_deletion_requests
-- The agent link is set null when the agent is deleted; agent_name keeps a snapshot.
-- ---------------------------------------------------------------------------

create table public.agent_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  agent_id uuid,
  agent_name text not null check (char_length(agent_name) between 1 and 60),
  requested_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_by uuid references auth.users on delete set null,
  decided_at timestamptz,
  constraint agent_deletion_requests_agent_fkey
    foreign key (workspace_id, agent_id) references public.agents (workspace_id, id) on delete set null (agent_id),
  constraint agent_deletion_requests_decided_check check (
    (status = 'pending' and decided_by is null and decided_at is null)
    or (status <> 'pending' and decided_at is not null)
  )
);

create unique index agent_deletion_requests_pending_key
  on public.agent_deletion_requests (agent_id) where status = 'pending';
create index agent_deletion_requests_workspace_created_idx
  on public.agent_deletion_requests (workspace_id, created_at desc);

-- Owners only decide: status pending -> approved or declined, once, with decided_by = the caller.
-- Every other column is fixed, except agent_id going to null (the foreign key's set null on agent delete).
create function public.agent_deletion_requests_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.agent_name is distinct from old.agent_name
     or new.requested_by is distinct from old.requested_by
     or new.created_at is distinct from old.created_at then
    raise exception 'agent_deletion_requests: only the decision can change' using errcode = '42501';
  end if;
  if new.agent_id is distinct from old.agent_id and new.agent_id is not null then
    raise exception 'agent_deletion_requests.agent_id can only be cleared' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if old.status <> 'pending' then
      raise exception 'agent_deletion_requests: already decided' using errcode = '42501';
    end if;
    if auth.uid() is not null and new.decided_by is distinct from auth.uid() then
      raise exception 'agent_deletion_requests.decided_by must be the caller' using errcode = '42501';
    end if;
  elsif new.decided_by is distinct from old.decided_by or new.decided_at is distinct from old.decided_at then
    raise exception 'agent_deletion_requests: decided_* change only with the status' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger agent_deletion_requests_guard_update_trg
  before update on public.agent_deletion_requests
  for each row execute function public.agent_deletion_requests_guard_update();

-- ---------------------------------------------------------------------------
-- agent_reports: what is kept of a deleted agent (learner progress of its teach sessions).
-- Written by the server with the service role after the owner check; members read.
-- ---------------------------------------------------------------------------

create table public.agent_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  agent_id uuid not null unique,
  agent_name text not null,
  deleted_by uuid references auth.users on delete set null,
  deleted_at timestamptz not null default now(),
  teach jsonb not null default '[]'::jsonb check (jsonb_typeof(teach) = 'array')
);

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on table public.agent_deletion_requests from public, anon;
grant select, insert, update on table public.agent_deletion_requests to authenticated;
revoke all on table public.agent_reports from public, anon;
grant select on table public.agent_reports to authenticated;

revoke all on function public.agent_settings_patch(uuid, uuid, jsonb) from public, anon;
grant execute on function public.agent_settings_patch(uuid, uuid, jsonb) to authenticated;
revoke all on function public.agent_deletion_requests_guard_update() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row level security. Every policy is to authenticated. Every update policy has with check equal to using.
-- ---------------------------------------------------------------------------

alter table public.agent_deletion_requests enable row level security;

create policy agent_deletion_requests_select on public.agent_deletion_requests
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy agent_deletion_requests_insert on public.agent_deletion_requests
  for insert to authenticated
  with check (
    requested_by = auth.uid()
    and public.is_workspace_member(workspace_id)
    and status = 'pending'
    and decided_by is null
    and decided_at is null
  );

create policy agent_deletion_requests_update on public.agent_deletion_requests
  for update to authenticated
  using (public.workspace_role(workspace_id) = 'owner')
  with check (public.workspace_role(workspace_id) = 'owner');

alter table public.agent_reports enable row level security;

create policy agent_reports_select on public.agent_reports
  for select to authenticated
  using (public.is_workspace_member(workspace_id));
