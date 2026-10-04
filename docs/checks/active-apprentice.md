# Active apprentice (T-0240): manual checks

Manual checks for the active ask cadence, the continuous transcript and the live dock. docs/MANUAL_CHECKS.md is not changed by this task.

Setup: desktop companion paired, an agent with default settings, capture started from the app.

## Transcript
- [ ] Narrate while working without being asked ("I always check the supplier first because ..."). After the session the transcript holds every utterance with its time, names and emails redacted.
- [ ] Say "off the record", say something, say "back on the record". Nothing between the two phrases (phrases included) is in the transcript, the dock or the Work Map.
- [ ] The Work Map shows the narrated reason on the matching step with source narration; the debrief does not ask why for that step.

## Ask cadence
- [ ] Make a judgment call (e.g. move cost center 4711 to 0400), stop typing and talking: a short question about what is on screen comes after about 1-2 s.
- [ ] Keep typing after the change: no question until 2 s after the last key.
- [ ] Talk continuously: no question while talking.
- [ ] Explain a change before the apprentice asks: no question about it, a "got it" chip shows in the dock, no voice.
- [ ] Two judgment calls 30 s apart: only one question within a minute (default 'At most one question every' is 1 min); never more than 8 questions in 10 minutes.
- [ ] Set the agent's interval to 2 min: questions come at most every 2 min.
- [ ] Rollback: build with NEXT_PUBLIC_ASK_CADENCE=classic, the old cadence applies (20 s gap unless the agent sets one, 5 per 10 min, no narration skip).

## Dock
- [ ] The 'Now' line updates within about a second of each action ("Excel · cost center of invoice 4471 changed from 4711 to 0400").
- [ ] The state line reads 'noticed something' briefly after an action, then 'listening', 'thinking' or 'asking'.
- [ ] 'What I learned' gets a line within a few seconds of an unprompted explanation and of an answer.
- [ ] Off the record or paused: no 'Now' line, no chip. End task: the line is cleared.
- [ ] An older companion app (protocol 3) ignores dock.now and dock.ack without errors.
