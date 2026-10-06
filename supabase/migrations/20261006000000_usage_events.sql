-- 20261006000000_usage_events.sql
-- Cost meter 1/3: usage events (tokens, voice seconds, bytes), CHF price tables and the daily cost view.
-- Rollback: supabase/rollbacks/20261006000000_usage_events.down.sql
-- Never edit this file once applied. Later changes go in a new migration.
-- See docs/checks/cost-meter.md.
--
-- Members can read their workspace events. Nobody writes usage_events from a client: there is no
-- insert, update or delete policy, the only writer is the service role (src/lib/usage/events.ts).
-- Prices are readable by every signed-in user and written only by migrations.

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid,
  session_id text,
  kind text not null check (kind in ('vision', 'decide', 'workmap', 'voice', 'frame')),
  model text,
  input_tokens int,
  output_tokens int,
  cache_read_tokens int,
  voice_seconds numeric,
  bytes bigint,
  created_at timestamptz not null default now()
);

create index usage_events_ws_created on public.usage_events (workspace_id, created_at desc);

-- One voice row per server-issued token, per workspace (never global: a token collision cannot cross tenants).
create unique index usage_events_voice_token on public.usage_events (workspace_id, session_id) where kind = 'voice';

alter table public.usage_events enable row level security;

revoke all on table public.usage_events from public, anon;
grant select on table public.usage_events to authenticated;

create policy usage_events_select on public.usage_events
  for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

-- CHF per million tokens. Seeded from roadmap 3.7 USD list prices times a 0.90 USD->CHF placeholder
-- factor; review by 2027-01-01 (docs/checks/cost-meter.md). Every model id in src/lib/models.ts
-- (defaults and fallback) needs a row: src/lib/usage/prices.test.ts.
create table public.model_prices (
  model text not null,
  valid_from date not null,
  chf_per_m_input numeric not null,
  chf_per_m_output numeric not null,
  chf_per_m_cache_read numeric not null,
  primary key (model, valid_from)
);

alter table public.model_prices enable row level security;

revoke all on table public.model_prices from public, anon;
grant select on table public.model_prices to authenticated;

-- Any signed-in user. Not "using (true)": the migration lint rejects a true-alone expression.
create policy model_prices_select on public.model_prices
  for select
  to authenticated
  using (auth.uid() is not null);

insert into public.model_prices (model, valid_from, chf_per_m_input, chf_per_m_output, chf_per_m_cache_read) values
  ('claude-haiku-4-5-20251001', '2026-10-01', 0.90, 4.50, 0.09),
  ('claude-sonnet-5-5', '2026-10-01', 2.70, 13.50, 0.27),
  ('claude-opus-5-5', '2026-10-01', 3.60, 18.00, 0.36);

-- CHF per minute of voice: 0.08 USD x 0.90 placeholder factor.
create table public.voice_prices (
  valid_from date primary key,
  chf_per_minute numeric not null
);

alter table public.voice_prices enable row level security;

revoke all on table public.voice_prices from public, anon;
grant select on table public.voice_prices to authenticated;

create policy voice_prices_select on public.voice_prices
  for select
  to authenticated
  using (auth.uid() is not null);

insert into public.voice_prices (valid_from, chf_per_minute) values
  ('2026-10-01', 0.072);

-- Daily cost per workspace and kind. security_invoker: the caller's RLS on usage_events applies,
-- so a member sees only their workspaces. The day is the Europe/Zurich date of created_at.
-- Each row is priced with the latest price row valid on its day (lateral left join), so an unpriced
-- row survives with chf null and is counted in unpriced_events. Frame rows report bytes and are never
-- priced: a frame is written once and kept for the retention period, a per-day storage price is undefined.
-- Voice rows without voice_seconds (token issued, nothing reported yet) are left out.
create view public.usage_cost_daily
with (security_invoker = true)
as
select
  e.workspace_id,
  (e.created_at at time zone 'Europe/Zurich')::date as day,
  e.kind,
  count(*)::bigint as events,
  sum(e.input_tokens)::bigint as input_tokens,
  sum(e.output_tokens)::bigint as output_tokens,
  sum(e.cache_read_tokens)::bigint as cache_read_tokens,
  sum(e.voice_seconds) as voice_seconds,
  sum(e.bytes)::bigint as bytes,
  sum(
    case
      when e.kind in ('vision', 'decide', 'workmap') then
        (coalesce(e.input_tokens, 0) * mp.chf_per_m_input
          + coalesce(e.output_tokens, 0) * mp.chf_per_m_output
          + coalesce(e.cache_read_tokens, 0) * mp.chf_per_m_cache_read) / 1e6
      when e.kind = 'voice' then e.voice_seconds / 60 * vp.chf_per_minute
    end
  ) as chf,
  count(*) filter (
    where (e.kind in ('vision', 'decide', 'workmap') and mp.model is null)
       or (e.kind = 'voice' and vp.valid_from is null)
  )::bigint as unpriced_events
from public.usage_events e
left join lateral (
  select p.model, p.chf_per_m_input, p.chf_per_m_output, p.chf_per_m_cache_read
  from public.model_prices p
  where p.model = e.model
    and p.valid_from <= (e.created_at at time zone 'Europe/Zurich')::date
  order by p.valid_from desc
  limit 1
) mp on e.kind in ('vision', 'decide', 'workmap')
left join lateral (
  select v.valid_from, v.chf_per_minute
  from public.voice_prices v
  where v.valid_from <= (e.created_at at time zone 'Europe/Zurich')::date
  order by v.valid_from desc
  limit 1
) vp on e.kind = 'voice'
where e.kind <> 'voice' or e.voice_seconds is not null
group by e.workspace_id, (e.created_at at time zone 'Europe/Zurich')::date, e.kind;

revoke all on table public.usage_cost_daily from public, anon;
grant select on table public.usage_cost_daily to authenticated;
