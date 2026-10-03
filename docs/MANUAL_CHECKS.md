# Manual checks

Anything that needs a microphone, a live ElevenLabs conversation or a human on screen is listed here as a manual check; later tasks append sections.

## Sandbox ERP

1. `npm run dev`, open `/erp`. The list shows 4471, 4498, 4502, 4517 (no 4630). Header reads "Machina ERP - Accounts Payable".
2. Invoice A: click 4471. Event list shows `record_opened 4471`. Change cost center to 0400 (`field_changed 4471 cost_center 4711 -> 0400`), type an asset number and click outside the field (one `field_changed ... asset_number` on blur, none per keystroke). Click Save: `button_clicked save` then `status_changed approval_status open -> saved`; badge shows Saved.
3. Invoice B: click 4502 (4498, same supplier and amount, already saved, is visible above it). Click Hold: `button_clicked hold`, `status_changed ... open -> on_hold`.
4. Invoice C: click 4517 (CZ / subsidiary). Click Send for 2nd approval: `button_clicked second_approval`, `status_changed ... open -> second_approval`.
5. Detail view shows contact name and IBAN for each invoice.
6. Open `/erp?mode=teach`: the list shows 4630 plus 4498 as history; 4630 is the only open invoice.

## Voice

Needs `.env.local` with the ElevenLabs key and both agent ids (docs/VOICE_SETUP.md), a microphone, and a page that renders `useVoiceAgent` inside `VoiceProvider`.

- [ ] `curl 'localhost:3000/api/voice/signed-url?role=interviewer'` returns `{signed_url}` and no key.
- [ ] Interviewer greets once with the first message, then stays silent while you type in the demo app.
- [ ] After a judgment-like change (for example cost center of invoice 4471) and a pause of about 2 s, it asks one short question that names the object. It never reads a bracket tag aloud.
- [ ] No more than 5 live questions in 10 minutes; the rest show up in the debrief.
- [ ] Saying "off the record" makes it say only "Paused." and the transcript stops growing; resuming brings both back.
- [ ] Tutor: a `[GUARDRAIL_STOP]` turn makes it say "<Expert> would stop here. Why do you think?" and triggers `replay_moment`.

## Capture

Run `npm run dev`, open `/capture`. Voice needs the Voice setup above; without it the page runs in text mode.

- [ ] Layout: sandbox ERP on the left, narrow side panel on the right with a status dot, "0 asked, 0 about guardrails", last question, event feed, Start session.
- [ ] Start session (expert name Sabine). A session id appears under `data/sessions/<id>/session.json`. With voice the interviewer greets once; without keys or mic a notice says text mode and an answer input appears.
- [ ] Process invoices A (4471, cost center 4711 -> 0400, asset number, Save), B (4502, Hold) and C (4517, Send for 2nd approval) while talking. The feed shows the last 6 events.
- [ ] At pauses, at least 3 questions, each naming the on-screen object (for example "invoice 4471"), at least 1 about a guardrail (limit or when to stop and ask). The counter matches.
- [ ] No question while typing in the ERP; questions come about 2 s after typing stops.
- [ ] Answers end up as QA pairs with `event_id`, `t_question`, `t_answer` in `session.json`.
- [ ] Press Pause: red "OFF THE RECORD - nothing is captured" banner, status dot paused. Click around and talk for 10 s: `events`, `transcript` and `frames/` in `data/sessions/<id>/` do not grow. Resume closes the range in `off_record_ranges`.
- [ ] Say (or in text mode type) "off the record": same as Pause. In text mode, type "back on the record" to resume; with voice the mic is muted while paused, so resume with the button or the agent's `set_off_record` tool.
- [ ] Share screen: the browser picker opens; changed frames show up under `frames/`; none while paused. Without sharing, DOM events still drive questions.
- [ ] End task navigates to `/debrief/<id>`.
