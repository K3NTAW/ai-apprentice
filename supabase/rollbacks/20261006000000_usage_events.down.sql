-- 20261006000000_usage_events.down.sql
-- Rollback for supabase/migrations/20261006000000_usage_events.sql
--
-- Destroys billing history: every usage event and every price row is deleted.
-- Order: the view, the policies, the price tables, the usage_events indexes, then usage_events.
--
-- When the migration was applied with supabase db push, also run
--   supabase migration repair --status reverted 20261006000000

drop view if exists public.usage_cost_daily;

drop policy if exists usage_events_select on public.usage_events;
drop policy if exists model_prices_select on public.model_prices;
drop policy if exists voice_prices_select on public.voice_prices;

drop table if exists public.voice_prices;
drop table if exists public.model_prices;

drop index if exists public.usage_events_voice_token;
drop index if exists public.usage_events_ws_created;

drop table if exists public.usage_events;
