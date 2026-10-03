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
