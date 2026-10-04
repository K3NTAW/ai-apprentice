# Manual checks: agent-settings (T-0188)

Needs migration 20261004010000_agent_settings applied (before it, the Settings tab shows the defaults and
"Settings are not available yet"; saving answers 503 settings_unavailable).

1. /agents/<id>?tab=settings as owner: four cards Identity, Questions while training, Privacy, Delete <agent>.
2. Change Name, tab out: "Saved." under Identity, header shows the new name after refresh. Empty name: inline error.
3. Set "At most one question every" to 2 min, train: a second question never comes within 120 s of the first.
4. Turn "Learn keyboard shortcuts" off, train with the companion: no shortcut events in the session, no shortcut question.
5. Turn "Redact IBANs and phone numbers" off, say an IBAN while training: the transcript keeps it; names still redacted.
6. Set the phrase to "pause please", say it: the session goes off the record. ⌥⇧O and the button still work.
7. As expert: Privacy controls are disabled; PATCH with retention_days answers 403.
8. As expert: "Request deletion". As owner on /workspace: Deletion requests shows it; Approve deletes the agent, its
   capture sessions and frames; teach sessions stay; a row in agent_reports keeps them. Decline leaves the agent.
9. Owner Delete: the confirm button stays disabled until the agent name is typed exactly.
10. Cron: `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/retention` answers
    {"agents":n,"deleted":n,"more":false}; without the header 401. With retention 7 days, frames older than 7 days
    are gone from Storage and session_frames.

Session start reads the settings once (CaptureApp wiring is a follow-up, see the T-0188 result).
Rollback: supabase/rollbacks/20261004010000_agent_settings.down.sql (drops stored settings, requests and reports).
