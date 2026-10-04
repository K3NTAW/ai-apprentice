-- 20261004040000_session_teach.sql
-- Teach progress per session (sessions.teach), written by POST /api/session/[id]/teach and read by the
-- Learners tab and the agent stats. Null until the first save. The shape is TeachProgressSchema in
-- src/lib/types.ts; the CHECK below mirrors its keys and types (the app validates the rest with zod).
-- Writes go through the existing sessions_update policy (can_write_session) and sessions_guard_update.
-- Rollback: supabase/rollbacks/20261004040000_session_teach.down.sql

alter table public.sessions add column teach jsonb;

alter table public.sessions
  add constraint sessions_teach_check check (
    teach is null
    or (
      jsonb_typeof(teach) = 'object'
      and (teach - array['workmap_session_id', 'mastered', 'practice', 'interventions', 'finished_at']) = '{}'::jsonb
      and jsonb_typeof(teach -> 'workmap_session_id') = 'string'
      and jsonb_typeof(teach -> 'mastered') = 'array'
      and jsonb_typeof(teach -> 'practice') = 'array'
      and jsonb_typeof(teach -> 'interventions') = 'number'
      and (not teach ? 'finished_at' or jsonb_typeof(teach -> 'finished_at') = 'string')
    )
  );
