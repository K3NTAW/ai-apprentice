# Manual checks: agents-shortcuts (T-0113, agents wave A5)

Needs the desktop companion with protocol v3 (chord, dock.*, session.state.agent).

1. Open /capture?agent=<agent id>, pair the companion, start. The dock shows on the right with the agent's avatar.
2. In Outlook press Cmd+Shift+M three times on different mails. At the next pause the apprentice asks
   "You pressed Cmd+Shift+M in Microsoft Outlook there. What does it do for you and why that way?"
3. Answer. The dock's 'What I learned' feed shows the shortcut line once, then the answer line.
4. Press two other repeated shortcuts within 3 minutes: no second live shortcut question; they show in the debrief.
5. Say "off the record", press a chord: nothing reaches the feed or the session events. Say "back on the record".
6. Type plain text and Shift+letters: no chord events. Type in a password field: no chord events (companion side).
7. End the task: the dock hides. Reload the page mid-session and re-pair: the dock shows again.
8. Work Map export lists "## Keyboard shortcuts" with effect, count and the expert's why.
9. Teach the same Work Map and do the shortcut step by mouse: the tutor says "<Expert> uses <chord> here." once.

Rollback: set SHORTCUT_LEARNING to false in src/lib/companion/chord.ts. Chords, dock and session.state.agent stop;
Capture and Teach run as before.
