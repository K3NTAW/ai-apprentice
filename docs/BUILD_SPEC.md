# AI Apprentice — Build Spec for Orchestrator

> 7th Global AI Hackathon · Hack-Nation × ElevenLabs · Challenge 01
> Time budget: **24 hours**. Goal: a working end-to-end MVP that passes "The Apprentice Test" and hits the "What Good Looks Like" bar live.

---

## 1. The Problem (context for all agents)

Experienced people are retiring and their judgment leaves with them. Screen recordings and task-mining capture **what** was clicked, never **why**. Guardrails (limits, exceptions, when to stop and ask) are almost never written down.

**Running example:** Sabine (57) has run accounts payable at a machine builder for 24 years. Lena (26) is new. Sabine silently:
- re-codes an invoice to a different cost center (equipment > €5,000 is always capex),
- holds an invoice because that supplier double-bills every December,
- sends an invoice for second approval because it comes from the Czech subsidiary.

None of this is in the 2019 process document. Sabine retires in 18 months.

**Core principle — an apprentice, not a recorder:** A recorder captures what happened. An automation copies clicks. An apprentice asks *why*, learns the rules and guardrails behind each step, and keeps asking until nothing is unclear. **If a new person could not do the task from what it learned, it is not an AI Apprentice.**

---

## 2. Required Modules (build all three)

### Module 1 — Capture
Web app. Expert shares their screen; an ElevenLabs voice agent listens in a side panel. Every 1–2 s a frame goes to a vision model and becomes events (e.g. `invoice 4471 opened`, `cost center changed 4711 → 0400`). The agent stays quiet while the expert types, reads or talks, and asks at natural pauses: why this step, is there a limit, when would you stop and ask someone?

**Hard requirement:** During a real task the agent asks **≥ 3 questions**, each at a natural pause and about something **visible on screen**. **≥ 1** must be about a guardrail.

### Module 2 — Map
When the task ends, a short **spoken debrief**: asks about what is still unclear, then explains the whole process back (teach-back) so the expert can confirm or correct. Output: the **Work Map** — a clickable timeline; every step shows the screen moment, the decision, the reason in the expert's words, and the guardrails.

Example step:
| Field | Value |
|---|---|
| Step | 4 of 7: code the invoice to a cost center |
| Screen moment | 03:12, invoice 4471, cost center field |
| Decision | Re-coded from opex (4711) to capex (0400) |
| Reason | "Equipment over €5,000 is always capex." — Sabine, live question at 03:15 |
| Guardrails | No asset number, no capex booking. Unknown supplier: stop and ask the controller. |

**Hard requirement:** Debrief asks **≥ 3 follow-up questions** not answered during the task and ends with a **teach-back the expert confirms**. Every step and guardrail links to a screen moment **and** the expert's own words.

### Module 3 — Teach
Work Map becomes a voice tutor. New hire works a case on their own screen; tutor watches, explains each step the way the expert did, asks them to predict the next decision, and **steps in before a guardrail is broken**, replaying the expert's screen moment when useful. Ends with what they mastered and what to practice next.

**Hard requirement:** A judge playing a new hire processes a case the expert **never showed**. The tutor catches **≥ 1 wrong decision before it is saved** and explains it using the **expert's reasoning**.

---

## 3. The Apprentice Test (demo must answer all five)

1. **When to ask** — How does the agent know the expert paused, and stay quiet while they type, read or talk?
2. **What to ask** — How does it pick the question that reveals a reason or guardrail, not one the screen already answers?
3. **When it has understood** — How does the debrief decide it is done, and how does the teach-back prove it?
4. **Whether the new hire learned** — How do you show they can handle a new case alone?
5. **Trust** — How can the expert take something off the record, and how is personal data on screen protected?

Our answer to each is mapped in §6.

---

## 4. What Good Looks Like (the demo script — build to this exactly)

1. Judge plays Sabine, shares screen, processes three invoices while talking.
2. At a pause, a calm voice: *"You moved that one to capex. What made you do that?"* → "Equipment over €5,000 is always capex."
3. Debrief: *"You held the December invoice. Is that for every supplier, and who decides when to release it?"*
4. Apprentice explains the whole process back in **under a minute**; judge corrects one detail.
5. Work Map shows **7 steps, 3 judgment calls, 4 guardrails**, each linked to its screen moment.
6. Second judge plays new hire, opens a fresh **€7,200 equipment invoice**, reaches for the opex code.
7. Tutor: *"Sabine would stop here. Why do you think?"* — replays her screen moment, lets them fix it.

**Strong vs weak (judging):**
| Strong | Weak |
|---|---|
| Asks at natural pauses, about what is on screen | Interrupts mid-typing, generic questions |
| Captures guardrails: limits, exceptions, when to stop and ask | Happy path only |
| Debrief closes gaps and ends with a teach-back | Summary written from transcript afterwards |
| Tutor teaches the new hire to *decide*, in the expert's words | A screen recording nobody watches |
| Pitch with a clear moonshot and a path to it | Demo that stops at the demo |

---

## 5. Design Decisions (already agreed — do not relitigate)

| # | Decision | Rationale |
|---|---|---|
| D1 | **No humanlike avatar.** Minimal side panel / small voice presence in Capture. | Time sink; scores nothing on the Apprentice Test. |
| D2 | **Clicky-style pointing (halo/cursor highlight) only in Teach.** Never in Capture. | In Capture the expert drives; a moving AI cursor interferes. In Teach it is the demo's best moment. |
| D3 | **Build our own sandbox ERP inside the web app.** | Lets the tutor hook Save, highlight fields precisely, replay moments inline. Pure vision loses the race against the user's click. |
| D4 | **Hybrid perception:** vision model is the primary screen understanding ("works on anything"); DOM events from our sandbox are ground truth / fallback and power the save hook. | Reliability for a live demo; be upfront about this in the pitch. |
| D5 | **Jev (TypeSafe AI) as the fast decision layer**, NOT as the conversational brain. A normal LLM runs the ElevenAgents conversation, question wording, Work Map synthesis and teach-back. | Jev returns typed, calibrated decisions (choice / score / yes-no) in ~70–500 ms; it does not generate text. |
| D6 | **Jev behind a single interface** (`decide(question, state) → {answer, confidence}`) with an LLM-JSON fallback. | Jev is waitlist/early access; must be swappable in minutes. |
| D7 | **Ask less, later.** 3–5 live questions per 10 minutes; everything else goes to the debrief. | From the brief; keeps the expert in flow. |

---

## 6. How We Answer the Apprentice Test

| Test question | Mechanism |
|---|---|
| 1. When to ask | Scribe v2 Realtime → speech-pause signal. Input activity (keystrokes/mouse from sandbox) + frame-diff stillness → typing/reading signal. Jev gate: `ask_now / wait / save_for_debrief`. |
| 2. What to ask | Jev classifies each event: `routine / judgment_call / possible_guardrail` and `screen_explains_it: yes/no`. Only judgment calls and guardrails with unexplained reasons get live questions. LLM writes the question referencing the on-screen object. |
| 3. When understood | Jev scores every Work Map step: `reason_captured_in_expert_words` and `guardrail_captured` (0–1). Debrief targets lowest scores; ends when all steps exceed threshold. **Show scores rising in the UI.** Teach-back is spoken; expert says "yes, that is how it works" → explicit confirm event. |
| 4. New hire learned | Unseen case (€7,200 equipment invoice). Prediction prompts ("what would you do next?"), save-hook interception, mastery summary per step. |
| 5. Trust | Spoken "off the record" command + visible pause button that **actually stops** frames + transcript. Microsoft Presidio redacts PII in transcripts before storage (and frames if time allows). Show it once in the demo. |

---

## 7. Architecture

```
┌──────────── Browser (Next.js/React + TS) ────────────┐
│  Sandbox ERP  ──DOM events──┐                        │
│  getDisplayMedia → canvas → frame every ~1.5s        │
│      └ local pixel diff (skip unchanged frames)      │
│  ElevenLabs agent widget (Capture: interviewer,      │
│                           Teach: tutor)              │
│  Work Map viewer · Teach halo overlay · Save hook    │
└──────────────┬───────────────────────────────────────┘
               │
┌──────────────▼──────────── Backend (Node/TS) ─────────┐
│ /vision     frame → vision LLM → ScreenEvent[] (JSON) │
│ /decide     Jev wrapper (fallback: LLM JSON)          │
│ /session    store events, transcript, Q&A, frames     │
│ /workmap    LLM merge → WorkMap JSON + gap list       │
│ /redact     Presidio                                  │
│ /export     WorkMap → agent-ready guardrails .md      │
└───────────────────────────────────────────────────────┘
```

**ElevenLabs:** ElevenAgents for both roles (interviewer, tutor), Expressive Mode for a curious, patient voice. LLM chosen in ElevenAgents. Scribe v2 Realtime for listening/pause detection. Client tools / contextual updates push screen events into the live conversation. Work Map goes into the tutor's knowledge base and Procedures. Optional: MCP tool so the tutor can look up guardrails.

> ⚠️ **Verify against current docs** (do not guess): exact ElevenLabs SDK methods for pushing contextual updates / user messages mid-conversation and for making the agent speak proactively; exact Jev API request/response shape.

---

## 8. Data Contracts

### ScreenEvent
```json
{
  "id": "ev_031",
  "t": 192.4,
  "source": "vision | dom",
  "type": "record_opened | field_changed | button_clicked | status_changed",
  "entity": { "kind": "invoice", "id": "4471" },
  "field": "cost_center",
  "from": "4711",
  "to": "0400",
  "frame_ref": "frames/0192.jpg"
}
```

### Decision-layer questions (Jev or fallback)
| Name | Type | Options / Output |
|---|---|---|
| `event_class` | choice | `routine`, `judgment_call`, `possible_guardrail` |
| `screen_explains_it` | yes/no prob | — |
| `ask_timing` | choice | `ask_now`, `wait`, `save_for_debrief` |
| `step_reason_captured` | score 0–1 | per Work Map step |
| `step_guardrail_captured` | score 0–1 | per Work Map step |
| `violates_guardrail` | yes/no prob | Teach: pending decision vs guardrails |

### WorkMap
```json
{
  "task": "Process supplier invoices before month-end close",
  "expert": "Sabine",
  "confirmed_by_expert": true,
  "steps": [
    {
      "n": 4,
      "title": "Code the invoice to a cost center",
      "screen_moment": { "t": 192.0, "frame_ref": "frames/0192.jpg", "entity": "invoice 4471", "field": "cost_center" },
      "decision": "Re-coded from opex (4711) to capex (0400)",
      "is_judgment_call": true,
      "reason": { "quote": "Equipment over €5,000 is always capex.", "t": 195.0, "source": "live_question" },
      "guardrails": [
        { "rule": "No asset number, no capex booking.", "quote_ref": 211.5, "kind": "limit" },
        { "rule": "Unknown supplier: stop and ask the controller.", "quote_ref": 640.2, "kind": "stop_and_ask" }
      ],
      "scores": { "reason_captured": 0.93, "guardrail_captured": 0.88 }
    }
  ],
  "open_questions": []
}
```

---

## 9. Sandbox ERP Seed Data (fake)

Invoice list + invoice detail view. Fields: supplier, supplier country/entity, date, amount, description, cost center, asset number, approval status. Buttons: **Save**, **Hold**, **Send for 2nd approval**.

| Invoice | Purpose |
|---|---|
| A | Equipment > €5,000, pre-coded to opex 4711 → expert re-codes to capex 0400 (needs asset number) |
| B | Supplier known to double-bill in December → expert holds it |
| C | From Czech subsidiary → expert sends for second approval |
| **T (Teach only, never shown to expert)** | **€7,200 equipment invoice**, pre-coded or default opex → new hire must be stopped |

All data fake. Include some fake PII (names, IBAN-like strings) to demo Presidio redaction.

---

## 10. Workstreams (parallelizable)

| WS | Owner focus | Deliverables |
|---|---|---|
| **WS-A Voice & Agent** | ElevenAgents interviewer + tutor, proactive speaking, Scribe pause signal, debrief + teach-back flow, "off the record" command | Agent configs, prompts, client tools |
| **WS-B Perception** | Screen capture, frame diff, vision → ScreenEvent, DOM event emitter, merge both streams | `/vision`, event bus |
| **WS-C Decision layer** | Jev wrapper + LLM fallback, all §8 questions, thresholds, scoring loop | `/decide` |
| **WS-D App & UI** | Sandbox ERP, side panel, Work Map timeline viewer, Teach halo overlay, save hook, replay, mastery summary | Frontend |
| **WS-E Map & Trust** | Work Map synthesis, gap list, Presidio, export to agent-ready guardrails | `/workmap`, `/redact`, `/export` |

---

## 11. 24-Hour Timeline

| Hours | Goal | Exit criterion |
|---|---|---|
| **0–2** | **Spike the three riskiest things.** (1) Agent speaks proactively after we inject an event. (2) Jev call works (else switch to fallback, move on). (3) One frame → valid ScreenEvent JSON. | All three demonstrated in a throwaway script. **No UI before this.** |
| 2–5 | Sandbox ERP with seed data + DOM events | Expert can process A, B, C; events stream |
| 5–10 | Capture loop: events → decision gate → agent asks | ≥ 3 well-timed, on-screen questions incl. 1 guardrail; Q&A stored with timestamps + frames |
| 10–14 | Debrief + Work Map + scores + teach-back + timeline viewer | ≥ 3 follow-ups, confirmed teach-back, clickable map |
| *~12–15* | *Sleep ~3 h (in shifts if team)* | |
| 14–19 | Teach: tutor, save hook, halo, replay, prediction prompts, mastery summary | Invoice T caught before save, explained in Sabine's words |
| **~18–19** | **Record backup video of the full loop + save a clean Sabine session** | Video file exists |
| 19–21 | Trust: off-the-record, pause, Presidio; agent-ready export if slack | Shown working once |
| 21–24 | Rehearse demo script ×2, pitch deck incl. moonshot slide, buffer | Ready |

**Cut order if behind:** (1) two-expert stretch, (2) German→English stretch, (3) Work Map UI polish, (4) frame redaction (keep transcript redaction).
**Never cut:** save-hook interception, debrief teach-back, ≥ 1 guardrail question in Capture, off-the-record.

---

## 12. Acceptance Checklist

- [ ] Capture: ≥ 3 questions at natural pauses, about visible screen content, ≥ 1 guardrail
- [ ] Agent never speaks while expert is typing/talking
- [ ] Debrief: ≥ 3 follow-ups not answered live
- [ ] Teach-back spoken in < 1 min; expert confirm/correct captured
- [ ] Work Map: every step + guardrail links to a screen moment AND expert quote
- [ ] Understanding scores visible and drive debrief end
- [ ] Teach: unseen €7,200 invoice, wrong decision blocked **before save**, explained with Sabine's reasoning, replay available
- [ ] Mastery summary at end of Teach
- [ ] Off-the-record command + pause button stop capture
- [ ] PII redacted before storage
- [ ] Backup demo video recorded
- [ ] Pitch ends with moonshot slide

---

## 13. Stretch Goals (only after checklist is green)

- **Any language:** expert explains in German, tutor teaches in English.
- **Agent-ready guardrails:** export Work Map as instructions an agent can load (~30 min; strengthens moonshot).
- **Two experts, one task:** diff two sessions, ask each expert why.

## 14. Moonshot (pitch slide)

Path: today's MVP (one expert, one task, one new hire) → **always-on apprentice** that notices never-seen cases during normal work and asks one question at the right moment (the Jev gate is already this) → **people first, then agents**: the same Work Map guardrails let agents take routine steps safely while people keep the judgment calls → a **living company memory** where the apprentice only asks about what changed.

## 15. Risks

| Risk | Mitigation |
|---|---|
| Agent can't speak proactively | Spike in hour 0–2; fallback: inject a synthetic user turn that triggers the question |
| Jev access / behavior | D6 interface + LLM JSON fallback |
| Vision latency/errors live | Frame diff, DOM events as ground truth |
| Noisy hackathon room | Headset with good mic; push-to-mute for judges |
| Live demo failure | Backup video + pre-recorded Sabine session to demo Map & Teach |

## 16. Reference Links (from brief)

- ElevenAgents quickstart: elevenlabs.io/docs/eleven-agents/quickstart
- ElevenAgents LLM options: elevenlabs.io/docs/agents-platform/customization/llm
- ElevenLabs MCP tools: elevenlabs.io/docs/eleven-agents/customization/tools/mcp
- Microsoft Presidio: github.com/microsoft/presidio
- WebArena (sandbox apps): webarena.dev
- O*NET tasks database: onetcenter.org/database.html
- Jev / TypeSafe AI: typesafe.ai
