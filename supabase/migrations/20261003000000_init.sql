-- 20261003000000_init.sql
-- Launch foundation: workspaces, members, invites, sessions and their child rows,
-- helper functions, bootstrap_workspace, guard triggers, RLS and the private frames bucket.
-- Rollback: supabase/rollbacks/20261003000000_init.down.sql
-- Never edit this file once applied. Later changes go in a new migration.
--
-- Delete rule: data cascades only from a workspace to its children. Deleting a user
-- removes their memberships and sets creator columns to null. It never deletes a
-- workspace or a session. Storage objects are NOT removed by row deletes or cascades:
-- the app deletes the objects through the Storage API before deleting a session_frames
-- row, a session or a workspace. An orphan sweep is a later task.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null check (role in ('owner', 'expert', 'learner')),
  created_at timestamptz not null default now(),
  constraint workspace_members_pkey primary key (workspace_id, user_id)
);

create index workspace_members_user_id_idx on public.workspace_members (user_id);

-- An accepted invite stays as history. The owner inserts a new pending invite to re-invite.
create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  email text not null check (email = lower(email)),
  role text not null check (role in ('expert', 'learner')),
  invited_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create unique index workspace_invites_pending_key
  on public.workspace_invites (workspace_id, email)
  where accepted_at is null;

-- sessions.id: the character class equals ID_RE in src/lib/store/index.ts, which has no
-- length bound. The store generates ids as prefix_ plus 8 base36 chars (about 20 chars).
-- The Supabase store backend (task C) must generate ids within 128 characters with a
-- random component.
-- Ids are globally unique, so an insert collision reveals to an authenticated user that
-- an id exists in some workspace. Accepted, ids are random.
create table public.sessions (
  id text primary key check (id ~ '^[a-zA-Z0-9_-]{1,128}$'),
  workspace_id uuid not null references public.workspaces on delete cascade,
  created_by uuid references auth.users on delete set null,
  kind text not null check (kind in ('capture', 'teach')),
  expert text,
  started_at timestamptz not null,
  ended_at timestamptz,
  off_record_ranges jsonb not null default '[]',
  workmap jsonb,
  created_at timestamptz not null default now()
);

create index sessions_workspace_started_idx on public.sessions (workspace_id, started_at desc);

create table public.session_events (
  id bigserial primary key,
  session_id text not null references public.sessions on delete cascade,
  t double precision not null,
  payload jsonb not null
);

create index session_events_session_t_idx on public.session_events (session_id, t);

create table public.session_transcript (
  id bigserial primary key,
  session_id text not null references public.sessions on delete cascade,
  t double precision not null,
  payload jsonb not null
);

create index session_transcript_session_t_idx on public.session_transcript (session_id, t);

create table public.session_qa (
  session_id text not null references public.sessions on delete cascade,
  qa_id text not null,
  t double precision,
  payload jsonb not null,
  primary key (session_id, qa_id)
);

create table public.session_frames (
  session_id text not null references public.sessions on delete cascade,
  name text not null,
  t double precision,
  storage_path text not null,
  primary key (session_id, name)
);

-- ---------------------------------------------------------------------------
-- Table and sequence privileges (defence in depth, RLS stays the gate)
-- service_role is left untouched.
-- ---------------------------------------------------------------------------

revoke all on table public.workspaces from public, anon;
grant select, insert, update, delete on table public.workspaces to authenticated;

revoke all on table public.workspace_members from public, anon;
grant select, insert, update, delete on table public.workspace_members to authenticated;

revoke all on table public.workspace_invites from public, anon;
grant select, insert, update, delete on table public.workspace_invites to authenticated;

revoke all on table public.sessions from public, anon;
grant select, insert, update, delete on table public.sessions to authenticated;

revoke all on table public.session_events from public, anon;
grant select, insert, update, delete on table public.session_events to authenticated;

revoke all on table public.session_transcript from public, anon;
grant select, insert, update, delete on table public.session_transcript to authenticated;

revoke all on table public.session_qa from public, anon;
grant select, insert, update, delete on table public.session_qa to authenticated;

revoke all on table public.session_frames from public, anon;
grant select, insert, update, delete on table public.session_frames to authenticated;

revoke all on sequence public.session_events_id_seq from public, anon;
grant usage on sequence public.session_events_id_seq to authenticated;

revoke all on sequence public.session_transcript_id_seq from public, anon;
grant usage on sequence public.session_transcript_id_seq to authenticated;

-- ---------------------------------------------------------------------------
-- Helper functions
-- Policies call only these helpers and never subselect public.workspace_members or
-- public.sessions directly (that would recurse through RLS).
-- No leak: can_read_session and can_write_session return false, and
-- session_frame_prefix returns null, for a missing session and for a non-member alike.
-- Boolean helpers return false, never null, for null input and for a missing row.
-- workspace_role returns null for a non-member or a missing workspace.
-- ---------------------------------------------------------------------------

create function public.is_workspace_member(ws uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1
      from public.workspace_members m
      where m.workspace_id = ws
        and m.user_id = auth.uid()
    ),
    false
  )
$$;

-- Used by the storage read policy, so no path segment is ever cast to uuid.
create function public.is_workspace_member_text(ws text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1
      from public.workspace_members m
      where m.workspace_id::text = ws
        and m.user_id = auth.uid()
    ),
    false
  )
$$;

create function public.workspace_role(ws uuid)
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select m.role
  from public.workspace_members m
  where m.workspace_id = ws
    and m.user_id = auth.uid()
$$;

create function public.can_read_session(sid text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1
      from public.sessions s
      join public.workspace_members m on m.workspace_id = s.workspace_id
      where s.id = sid
        and m.user_id = auth.uid()
    ),
    false
  )
$$;

create function public.can_write_session(sid text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    exists (
      select 1
      from public.sessions s
      join public.workspace_members m on m.workspace_id = s.workspace_id
      where s.id = sid
        and m.user_id = auth.uid()
        and (s.created_by = auth.uid() or m.role = 'owner')
    ),
    false
  )
$$;

-- Returns workspace_id/session_id/ only when the caller is a member of that session
-- workspace, else null.
create function public.session_frame_prefix(sid text)
returns text
language sql
security definer
stable
set search_path = ''
as $$
  select s.workspace_id::text || '/' || s.id || '/'
  from public.sessions s
  join public.workspace_members m on m.workspace_id = s.workspace_id
  where s.id = sid
    and m.user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- bootstrap_workspace
-- This is the only path into workspace_members, so the app calls it on every login
-- callback (contract for the auth task). Acceptance is automatic, so an owner can add
-- any confirmed email without that user giving consent. Accepted for the MVP.
-- Idempotent for an unchanged invite set. A later call accepts invites that became
-- pending since.
-- ---------------------------------------------------------------------------

create function public.bootstrap_workspace()
returns table (workspace_id uuid, name text, role text)
language plpgsql
security definer
volatile
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed_at timestamptz;
  v_name text;
  v_ws uuid;
begin
  if v_uid is null then
    raise exception 'bootstrap_workspace: not authenticated' using errcode = '42501';
  end if;

  select u.email, u.email_confirmed_at
    into v_email, v_confirmed_at
  from auth.users u
  where u.id = v_uid;

  if v_email is null or v_email = '' then
    raise exception 'bootstrap_workspace: user has no email' using errcode = '42501';
  end if;

  if v_confirmed_at is null then
    raise exception 'bootstrap_workspace: email not confirmed' using errcode = '42501';
  end if;

  -- Two parallel first logins create one workspace.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));

  -- Accept every pending invite for this email in one statement. An existing role is
  -- never changed.
  with accepted as (
    update public.workspace_invites as i
    set accepted_at = now()
    where i.email = lower(v_email)
      and i.accepted_at is null
    returning i.workspace_id, i.role
  )
  insert into public.workspace_members as wm (workspace_id, user_id, role)
  select a.workspace_id, v_uid, a.role
  from accepted a
  on conflict on constraint workspace_members_pkey do nothing;

  if not exists (
    select 1
    from public.workspace_members m
    where m.user_id = v_uid
  ) then
    v_name := left(split_part(v_email, '@', 1), 60);
    if v_name = '' then
      v_name := 'workspace';
    end if;

    insert into public.workspaces as w (name, created_by)
    values (v_name, v_uid)
    returning w.id into v_ws;

    insert into public.workspace_members as wm (workspace_id, user_id, role)
    values (v_ws, v_uid, 'owner');
  end if;

  return query
    select m.workspace_id, w.name, m.role
    from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id
    where m.user_id = v_uid
    order by m.created_at, m.workspace_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Trigger functions and triggers
-- Every comparison is null-safe (is distinct from).
-- ---------------------------------------------------------------------------

create function public.sessions_guard_update()
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
  return new;
end
$$;

create trigger sessions_guard_update_trg
  before update on public.sessions
  for each row execute function public.sessions_guard_update();

create function public.workspace_members_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from old.workspace_id
     or new.user_id is distinct from old.user_id then
    raise exception 'workspace_members.workspace_id and user_id cannot change' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger workspace_members_guard_update_trg
  before update on public.workspace_members
  for each row execute function public.workspace_members_guard_update();

-- Last-owner guard. A sole owner cannot leave, be demoted or have their account deleted
-- until ownership is transferred or the workspace is deleted. This trigger is the single
-- control for at least one owner per workspace. An owner may promote another member to
-- owner and then step down or leave.
create function public.workspace_members_last_owner_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.workspaces w where w.id = old.workspace_id for update;
  if not found then
    -- The workspace itself is being deleted (cascade). Nothing to guard.
    return null;
  end if;

  if not exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = old.workspace_id
      and m.role = 'owner'
  ) then
    raise exception 'workspace % would have no owner, transfer ownership first', old.workspace_id
      using errcode = '42501';
  end if;
  return null;
end
$$;

create trigger workspace_members_last_owner_guard_trg
  after update or delete on public.workspace_members
  for each row execute function public.workspace_members_last_owner_guard();

-- One shared function for the four session child tables.
create function public.session_child_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.session_id is distinct from old.session_id then
    raise exception '%.session_id cannot change', tg_table_name using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger session_events_guard_update_trg
  before update on public.session_events
  for each row execute function public.session_child_guard_update();

create trigger session_transcript_guard_update_trg
  before update on public.session_transcript
  for each row execute function public.session_child_guard_update();

create trigger session_qa_guard_update_trg
  before update on public.session_qa
  for each row execute function public.session_child_guard_update();

create trigger session_frames_guard_update_trg
  before update on public.session_frames
  for each row execute function public.session_child_guard_update();

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------

revoke all on function public.sessions_guard_update() from public, anon, authenticated;
revoke all on function public.workspace_members_guard_update() from public, anon, authenticated;
revoke all on function public.workspace_members_last_owner_guard() from public, anon, authenticated;
revoke all on function public.session_child_guard_update() from public, anon, authenticated;

revoke all on function public.is_workspace_member(uuid) from public, anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;

revoke all on function public.is_workspace_member_text(text) from public, anon;
grant execute on function public.is_workspace_member_text(text) to authenticated;

revoke all on function public.workspace_role(uuid) from public, anon;
grant execute on function public.workspace_role(uuid) to authenticated;

revoke all on function public.can_read_session(text) from public, anon;
grant execute on function public.can_read_session(text) to authenticated;

revoke all on function public.can_write_session(text) from public, anon;
grant execute on function public.can_write_session(text) to authenticated;

revoke all on function public.session_frame_prefix(text) from public, anon;
grant execute on function public.session_frame_prefix(text) to authenticated;

revoke all on function public.bootstrap_workspace() from public, anon;
grant execute on function public.bootstrap_workspace() to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- Every policy is to authenticated. Every update policy has with check equal to using.
-- ---------------------------------------------------------------------------

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.sessions enable row level security;
alter table public.session_events enable row level security;
alter table public.session_transcript enable row level security;
alter table public.session_qa enable row level security;
alter table public.session_frames enable row level security;

-- workspaces: no insert policy, creation only through bootstrap_workspace.
create policy workspaces_select on public.workspaces
  for select to authenticated
  using (public.is_workspace_member(id));

create policy workspaces_update on public.workspaces
  for update to authenticated
  using (public.workspace_role(id) = 'owner')
  with check (public.workspace_role(id) = 'owner');

create policy workspaces_delete on public.workspaces
  for delete to authenticated
  using (public.workspace_role(id) = 'owner');

-- workspace_members: no insert policy, rows only come from bootstrap_workspace.
-- An owner may change the role of any member of that workspace, including their own.
-- The last-owner trigger keeps at least one owner.
create policy workspace_members_select on public.workspace_members
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy workspace_members_update on public.workspace_members
  for update to authenticated
  using (public.workspace_role(workspace_id) = 'owner')
  with check (public.workspace_role(workspace_id) = 'owner');

create policy workspace_members_delete on public.workspace_members
  for delete to authenticated
  using (public.workspace_role(workspace_id) = 'owner');

-- workspace_invites: owners only, no update policy.
create policy workspace_invites_select on public.workspace_invites
  for select to authenticated
  using (public.workspace_role(workspace_id) = 'owner');

create policy workspace_invites_insert on public.workspace_invites
  for insert to authenticated
  with check (public.workspace_role(workspace_id) = 'owner' and invited_by = auth.uid());

create policy workspace_invites_delete on public.workspace_invites
  for delete to authenticated
  using (public.workspace_role(workspace_id) = 'owner');

-- sessions
create policy sessions_select on public.sessions
  for select to authenticated
  using (public.is_workspace_member(workspace_id));

create policy sessions_insert on public.sessions
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and (
      (kind = 'capture' and public.workspace_role(workspace_id) in ('owner', 'expert'))
      or (kind = 'teach' and public.is_workspace_member(workspace_id))
    )
  );

create policy sessions_update on public.sessions
  for update to authenticated
  using (public.can_write_session(id))
  with check (public.can_write_session(id));

create policy sessions_delete on public.sessions
  for delete to authenticated
  using (public.can_write_session(id));

-- session_events
create policy session_events_select on public.session_events
  for select to authenticated
  using (public.can_read_session(session_id));

create policy session_events_insert on public.session_events
  for insert to authenticated
  with check (public.can_write_session(session_id));

create policy session_events_update on public.session_events
  for update to authenticated
  using (public.can_write_session(session_id))
  with check (public.can_write_session(session_id));

create policy session_events_delete on public.session_events
  for delete to authenticated
  using (public.can_write_session(session_id));

-- session_transcript
create policy session_transcript_select on public.session_transcript
  for select to authenticated
  using (public.can_read_session(session_id));

create policy session_transcript_insert on public.session_transcript
  for insert to authenticated
  with check (public.can_write_session(session_id));

create policy session_transcript_update on public.session_transcript
  for update to authenticated
  using (public.can_write_session(session_id))
  with check (public.can_write_session(session_id));

create policy session_transcript_delete on public.session_transcript
  for delete to authenticated
  using (public.can_write_session(session_id));

-- session_qa
create policy session_qa_select on public.session_qa
  for select to authenticated
  using (public.can_read_session(session_id));

create policy session_qa_insert on public.session_qa
  for insert to authenticated
  with check (public.can_write_session(session_id));

create policy session_qa_update on public.session_qa
  for update to authenticated
  using (public.can_write_session(session_id))
  with check (public.can_write_session(session_id));

create policy session_qa_delete on public.session_qa
  for delete to authenticated
  using (public.can_write_session(session_id));

-- session_frames: insert and update also pin storage_path to the session prefix.
-- The update policy is the one place where with check equals using by repeating the
-- extra path condition in both clauses.
create policy session_frames_select on public.session_frames
  for select to authenticated
  using (public.can_read_session(session_id));

create policy session_frames_insert on public.session_frames
  for insert to authenticated
  with check (
    public.can_write_session(session_id)
    and storage_path = public.session_frame_prefix(session_id) || name
  );

create policy session_frames_update on public.session_frames
  for update to authenticated
  using (
    public.can_write_session(session_id)
    and storage_path = public.session_frame_prefix(session_id) || name
  )
  with check (
    public.can_write_session(session_id)
    and storage_path = public.session_frame_prefix(session_id) || name
  );

create policy session_frames_delete on public.session_frames
  for delete to authenticated
  using (public.can_write_session(session_id));

-- ---------------------------------------------------------------------------
-- Storage: private frames bucket
-- Path layout: workspace_id/session_id/frame name
-- Text comparison only, no uuid cast. The update policy exists so that upsert of a
-- frame works.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public) values ('frames', 'frames', false) on conflict (id) do nothing;

create policy frames_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'frames'
    and public.is_workspace_member_text((storage.foldername(name))[1])
  );

create policy frames_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'frames'
    and public.can_write_session((storage.foldername(name))[2])
    and coalesce(starts_with(name, public.session_frame_prefix((storage.foldername(name))[2])), false)
  );

create policy frames_objects_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'frames'
    and public.can_write_session((storage.foldername(name))[2])
    and coalesce(starts_with(name, public.session_frame_prefix((storage.foldername(name))[2])), false)
  )
  with check (
    bucket_id = 'frames'
    and public.can_write_session((storage.foldername(name))[2])
    and coalesce(starts_with(name, public.session_frame_prefix((storage.foldername(name))[2])), false)
  );

create policy frames_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'frames'
    and public.can_write_session((storage.foldername(name))[2])
    and coalesce(starts_with(name, public.session_frame_prefix((storage.foldername(name))[2])), false)
  );
