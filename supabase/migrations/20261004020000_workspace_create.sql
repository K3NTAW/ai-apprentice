-- 20261004020000_workspace_create.sql
-- Users create further workspaces from the sidebar workspace menu (POST /api/workspace).
-- workspaces and workspace_members keep having no insert policy: create_workspace (security definer) inserts the
-- workspace and the owner membership in one transaction, like bootstrap_workspace does for the first one.
-- Adds an optional city to public.workspaces, shown after the name ('Finance Ops · Zug').
-- Rollback: supabase/rollbacks/20261004020000_workspace_create.down.sql
-- Never edit this file once applied. Later changes go in a new migration.

alter table public.workspaces
  add column if not exists city text
  constraint workspaces_city_length check (city is null or char_length(city) between 1 and 60);

-- ---------------------------------------------------------------------------
-- create_workspace
-- Name trimmed, 1..60 chars; city trimmed, empty is null, at most 60 chars. Each user owns at most 10 workspaces
-- (created_by = the user and an owner membership). Returns the new workspace id.
-- ---------------------------------------------------------------------------

create function public.create_workspace(p_name text, p_city text default null)
returns uuid
language plpgsql
security definer
volatile
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_city text := nullif(btrim(coalesce(p_city, '')), '');
  v_owned integer;
  v_ws uuid;
begin
  if v_uid is null then
    raise exception 'create_workspace: not authenticated' using errcode = '42501';
  end if;

  if char_length(v_name) < 1 or char_length(v_name) > 60 then
    raise exception 'create_workspace: name must be 1 to 60 characters' using errcode = '22023';
  end if;

  if v_city is not null and char_length(v_city) > 60 then
    raise exception 'create_workspace: city must be at most 60 characters' using errcode = '22023';
  end if;

  -- Two parallel requests cannot both pass the limit.
  perform pg_advisory_xact_lock(hashtextextended('create_workspace:' || v_uid::text, 0));

  select count(*)
    into v_owned
  from public.workspaces w
  join public.workspace_members m on m.workspace_id = w.id
  where w.created_by = v_uid
    and m.user_id = v_uid
    and m.role = 'owner';

  if v_owned >= 10 then
    raise exception 'create_workspace: limit of 10 owned workspaces reached' using errcode = '53400';
  end if;

  insert into public.workspaces as w (name, city, created_by)
  values (v_name, v_city, v_uid)
  returning w.id into v_ws;

  insert into public.workspace_members as wm (workspace_id, user_id, role)
  values (v_ws, v_uid, 'owner');

  return v_ws;
end
$$;

revoke all on function public.create_workspace(text, text) from public, anon;
grant execute on function public.create_workspace(text, text) to authenticated;
