# Manual checks: processes slice (a) (T-0212, fix rounds T-0219, T-0225)

Data model, API and the read side: agent cards, header, filter tabs, the agent page tabs, Learn and Teach read the
agent's processes merged with legacy confirmed sessions (agentWorkMaps). Slices b-d wire the debrief, merge and editing.

Before migration 20261004030000_processes is applied:
1. `GET /api/processes` (signed in) answers 503 `{"error":"processes_unavailable","message":"processes not available yet"}`.
   Same for POST, `GET/PATCH/DELETE /api/processes/<id>`, `/api/processes/<id>/versions` and
   `POST /api/processes/backfill`. Never 500.
2. `/api/export?agent_id=<id>` still exports the agent's confirmed capture sessions.

After `supabase db push`:
3. As owner or expert, `POST /api/processes {agent_id, title, workmap}` answers 201 with version 1;
   `GET /api/processes/<id>/versions` lists one 'trained' row.
4. `PATCH /api/processes/<id> {workmap}` answers version 2 and adds an 'edited' row; `{title}` or `{archived}` alone
   keeps the version and adds no row. `{workmap, title, archived}` is one `update_process` call: with a stale
   expected_version nothing changes, title and archive included.
   `PATCH {workmap, expected_version: 1}` sent again answers 409 `process_version_conflict`; the process stays at
   version 2 and no version row is added. `confirmed` in a POST or PATCH body answers 400; the process's confirmed
   always equals the Work Map's confirmed_by_expert.
5. As owner, `PATCH {archived:true}` hides it from `GET /api/processes` (`?archived=1` shows it); `{archived:false}`
   restores it. As expert, both answer 403.
6. As expert, `DELETE /api/processes/<id>` answers 403; as owner 204, and its versions are gone.
   A session linked with source_session_id keeps its row, sessions.process_id is null.
7. As learner, POST and PATCH answer 403; GET works.
8. `/api/export?agent_id=<id>` exports the confirmed, non-archived processes (titled by the process) plus the
   agent's confirmed capture sessions that no process holds (legacy), newest first.
9. As owner, `POST /api/processes/backfill` (optional `{agent_id}`) answers `{created: n}` with one process per
   legacy confirmed session; a second call answers `{created: 0}`. Two calls at the same time create each process
   once (processes_source_session_key, create_process on conflict do nothing). A backfilled process's created_at
   equals its session's started_at, so the agent page order does not change. As expert, 403.
10. In SQL as an authenticated expert: `update public.processes set agent_id = ...`, `set workmap = ...`,
    `set version = ...`, `set confirmed = ...` and `set archived_at = now()` fail (42501 or permission denied);
    `insert`, `update` and `delete` on process_versions and `insert` on processes are denied for everyone.
    `select public.update_process(id, 1, ...)` with a stale version raises PT409; with
    `'{"task":"t","steps":"x"}'::jsonb` as p_workmap it raises 22023 'invalid workmap' (same for create_process).
11. With a row whose workmap fails WorkMapSchema (inserted as service role), `GET /api/processes` still answers 200
    without it and the server log names the row.
12. On /agents, a card counts the agent's confirmed processes plus its unlinked legacy confirmed sessions; an agent
    whose only ready Work Map is a process shows 'Ready to teach' and is in the Ready filter. The agent page header,
    Processes and Guardrails tabs agree. Learn lists the same Work Maps; Start opens Teach on the process's newest
    linked capture session, and Teach shows the process's current Work Map (titled by the process).

Rollback: supabase/rollbacks/20261004030000_processes.down.sql (lossy: drops processes, versions and sessions.process_id),
then `supabase migration repair --status reverted 20261004030000`.
