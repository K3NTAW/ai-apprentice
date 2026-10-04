# Manual checks: processes slice (a) (T-0212)

Data model and API only; the UI still lists sessions (slices b-d wire the debrief, merge and editing).

Before migration 20261004030000_processes is applied:
1. `GET /api/processes` (signed in) answers 503 `{"error":"processes_unavailable","message":"processes not available yet"}`.
   Same for POST, `GET/PATCH/DELETE /api/processes/<id>` and `/api/processes/<id>/versions`. Never 500.
2. `/api/export?agent_id=<id>` still exports the agent's confirmed capture sessions.

After `supabase db push`:
3. As owner or expert, `POST /api/processes {agent_id, title, workmap}` answers 201 with version 1;
   `GET /api/processes/<id>/versions` lists one 'trained' row.
4. `PATCH /api/processes/<id> {workmap}` answers version 2 and adds an 'edited' row; `{title}` alone keeps the version.
5. `PATCH {archived:true}` hides it from `GET /api/processes` (`?archived=1` shows it); `{archived:false}` restores it.
6. As expert, `DELETE /api/processes/<id>` answers 403; as owner 204, and its versions are gone.
   A session linked with source_session_id keeps its row, sessions.process_id is null.
7. As learner, POST and PATCH answer 403; GET works.
8. `/api/export?agent_id=<id>` exports the confirmed, non-archived processes (titled by the process) once the agent has any.
9. In SQL as an authenticated expert: `update public.processes set agent_id = ...` and any change to a
   process_versions row other than the set null paths raise 42501.

Rollback: supabase/rollbacks/20261004030000_processes.down.sql (lossy: drops processes, versions and sessions.process_id),
then `supabase migration repair --status reverted 20261004030000`.
