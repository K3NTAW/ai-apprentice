# Manual checks: pivot-teach (T-0094)

Teach on real apps: the tutor watches the learner's whole screen, asks for predictions at pauses and stops a wrong decision by voice and companion halo before the save.

## Fixture

- Work Map: a confirmed capture session by Sabine for "Code incoming purchase requests", or the sample (local mode: picker entry "Sample (demo)", same content as `EMAIL_FLOW_WORKMAP` in `src/lib/teach/fixtures.ts`). Step 3 "Set the cost code" carries the limit guardrail "Equipment over 5,000 EUR must be coded 0400" with Sabine's quote "Equipment over €5,000 is always capex, so it gets code 0400."
- Case: an email in Outlook (or a webmail tab) "Purchase request: servo press, EUR 7,200", and a sheet `purchases.xlsx` with columns amount and cost_code.
- Negative case: the same email with "EUR 1,200".
- Deterministic rule: a limit guardrail is parsed as "over <amount>" plus an optional required code ("coded 0400"). The case amount comes from the last amount/total/price field seen. If the amount cannot be parsed, the rule does not fire and decide('violates_guardrail') decides (stop at >= 0.6).

## Steps

1. `/teach`: pick the Work Map, Start. Voice starts (or text mode with a notice). The page shows the picker, Start, Share screen, Pause, Finish, the Desktop companion card, Current step, Tutor.
2. Share screen, pick "Entire screen". Pick a window instead once: an amber warning says halos are off; stop and pick the entire screen.
3. Pair the companion with the tray code: the card shows "Paired".
4. Open the email in Outlook. Current step becomes "Step 1: Open the purchase request email". At the next pause (no typing, screen still) the tutor asks "What would you do next?" about step 2.
5. Type EUR 7,200 into the amount cell, then 4711 into cost_code. Do not save.
6. Fix the code to 0400, reply to the requester, Finish.
7. Repeat steps 1 to 6 with the companion quit (not paired).
8. Repeat with the EUR 1,200 email.

## Pass

- Step 5: within a few seconds of 4711 appearing on screen, before any save, the tutor says "Sabine would stop here. Why do you think?", the page shows the quote and "Replay Sabine's moment" (frame plus quote inline), and a halo with a short bubble sits over the cost_code cell in Excel.
- The same wrong value does not trigger a second stop. Changing to 0400 removes the halo and the stop card. Moving on to another step, Pause, Finish, a companion disconnect and leaving the page all remove the halo.
- Step 6: the page shows Mastered and Practice next (step 3 under Practice next) and the tutor speaks it. The teach session's `teach` holds workmap_session_id, mastered, practice, interventions 1 and finished_at (ISO, UTC). With the sample map it says "Not saved" (no Work Map session).
- Step 7: the stop is by voice only and the page says "Companion not paired: the tutor stops by voice only, no halo over the app."
- Step 8: no stop at 4711 (amount under the limit).
- A failed or timed out guardrail check never stops; the Current step box shows the failure count. After a 429 it says the checks are paused (usage cap).

## Fail

- Any stop after the save instead of before, a halo on the wrong monitor or position, a second stop for the same value, a halo left on screen after Finish, a stop in the EUR 1,200 case.

Notes: halo rects map to the primary display, so they are only right when the shared surface is the whole primary monitor. Saving Session.teach posts to `/api/session/<id>/teach`; that route is outside this task's scope and needs a follow-up, until then the page shows "Not saved (... 404)". Rollback: revert the T-0094 commit.
