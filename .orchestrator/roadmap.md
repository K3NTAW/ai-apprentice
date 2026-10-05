# AI Apprentice: from hackathon build to product

Plan date 2026-10-06. Hackathon (Hack-Nation x ElevenLabs, Challenge 01) ended 2026-10-04 15:00 Europe/Zurich.

Sources: the repo at `/Users/k3ntaw/code/ai-apprentice`. The root checkout holds only `.orchestrator/`; the code was read from the newest worktree `wt/T-0279`, which matches the merged goal branch (README, docs/, src/, companion/, marketing/, supabase/migrations). Also `.orchestrator/plan.md`, the memory files and task results T-0268/T-0270/T-0271/T-0274, plus the hackathon status lines in the orchestrator's `.orchestrator/plan-log.md` (2026-10-03/04). Web research for section 2 and the cost model is linked inline. Facts marked "unverified" could not be confirmed.

---

## 0. One-page summary

- **Product in one line:** an AI apprentice watches an expert do real screen work, asks *why* by voice at natural pauses, turns the answers into a confirmed Work Map (steps, decisions, reasons, guardrails), then coaches new hires on their own screen against those guardrails.
- **Recommended position:** "Keep the judgment when the expert leaves". Sell expert knowledge capture for finance and operations back-office teams in DACH mid-market firms. The deliverable is a confirmed Work Map with guardrails. Teach (live coaching) is the second step, sold only once it is reliable. Do not position as a digital adoption platform or as task mining.
- **Five most severe gaps:** (1) full-monitor screen frames go unredacted to Anthropic and into storage. (2) There is no privacy policy, imprint, DPA, subprocessor list or DPIA, while the product processes employee screens and voices. (3) The macOS app is unsigned and not notarized, has no auto-update, and macOS permissions reset on every build. (4) Nothing is proven end to end on a real customer workflow: the last live e2e result is unrecorded, the workspace switch root cause is unknown, and Teach depends on about 5 s of vision latency. (5) There is no observability, no staging, no backups (Supabase free tier) and no billing.
- **Phases:** Phase 0 Stabilise (2 weeks), Phase 1 Private beta with 5 to 10 design partners (about 8 weeks), Phase 2 Paid launch (about 8 weeks). The goals are listed in section 4.
- **Top founder decisions:** the target position and first vertical; the frame policy (ephemeral by default, or stored as evidence); the legal entity, name and data-residency setup (EU-hosted models or US models under the DPF).

---

## 1. What the product is today

### 1.1 In eight lines

1. **For:** teams whose experts are about to retire or leave, and the new hires who replace them. The running example is accounts payable at a machine builder (Sabine, 24 years, retires in 18 months; Lena, new). See `docs/BUILD_SPEC.md` section 1.
2. **Capture:** the expert works in their own apps. A frame of the whole primary monitor is taken every 1.5 s and sent to Claude Haiku only when the screen changed (`src/lib/perception/capture.ts`). Haiku turns it into screen events.
3. **Ask:** an ElevenLabs voice agent (the interviewer) asks *why* only at a real pause. A pause means at least 1.2 s of speech silence, 2 s without typing and 1 s of stable screen. The caps are 1 question per 60 s and 8 per 10 minutes (`src/lib/voice/askGate.ts`). A decision layer chooses what to ask: Jev, then an LLM, then a heuristic (`src/lib/decide/`).
4. **Debrief and Work Map:** a spoken follow-up targets the lowest per-step scores. It finishes when every step reaches 0.75 and the expert confirms a teach-back of at most 130 words. Claude Opus synthesises the Work Map (`src/lib/workmap/`). Processes merge Work Maps across sessions and keep versions (`src/lib/processes/`).
5. **Teach:** a second ElevenLabs agent (the tutor) watches the new hire's screen and matches actions to Work Map steps. It runs deterministic limit rules parsed from guardrail text first, then one capped LLM decision, and stops the learner by voice with the expert's quote. A mastery summary closes the session (`src/lib/teach/`).
6. **Web app:** Next.js 16 App Router on Vercel (fra1), with Supabase Auth (password login plus email confirmation), Postgres with RLS on 15 tables, and a private `frames` bucket in eu-central-2 (Zurich). There are workspaces, invites, agents with clay avatars, Agent Settings, per-workspace daily usage caps, and a retention cron.
7. **Desktop app:** Electron (`companion/`), macOS dmgs for arm64 and x64 in the public release repo K3NTAW/ai-apprentice-desktop v0.1.0. It loads the web app in its own window and adds a cursor buddy, side dock, halo, floating panel, push-to-talk and shortcuts. It sends only key and click counts plus the frontmost app (`uiohook-napi`, `get-windows`).
8. **Live:** app https://ai-apprentice-app.vercel.app, marketing site https://apprentice.kentawaibel.com (also ai-apprentice-web.vercel.app). The repo K3NTAW/ai-apprentice is public. Size: about 28k lines of app source and about 4.5k lines of desktop source, with 1,544 web tests and 286 desktop tests at the final deploy (goal 3462a9b). It was built in about 20 hours by the orchestrator.

### 1.2 What was demo-only, faked or cut for the hackathon

| Item | Evidence | Why it matters for a product |
| --- | --- | --- |
| The expert name defaults to "Sabine" | `src/components/capture/CaptureApp.tsx:116,223` | Demo persona leaks into real sessions when an agent has no `expert_name`. |
| Sample Work Map "Sample (demo)" in Teach | `src/lib/teach/sampleWorkMap.ts`, `src/components/teach/loadWorkMap.ts` (offered only in local mode or when none exist) | Fine as an empty-state demo. It must never be taught as if it were a real process. |
| Fixture and preview routes (`/capture/preview`, `/teach/preview`, `/agents/preview`...) and `src/app/__audit` | `src/lib/fixtures/*`, `src/app/__audit/routes.tsx` | These were for comparing screens against the design canvas. They are local-mode only, but the surface should shrink for production. |
| **Frames are not redacted** | README "Trust", `marketing/app/privacy/page.tsx`, `src/app/api/vision/route.ts` (saves the frame and then sends the raw JPEG to the model) | Only text is redacted. Every screen pixel reaches Anthropic and Supabase Storage. Frame redaction was the first item cut (`.orchestrator/plan.md`, "Planner decisions"). |
| The whole monitor is captured | `getDisplayMedia({ displaySurface: "monitor" })` in `src/lib/perception/capture.ts` | Email, chat and banking windows next to the ERP are captured too. |
| Privacy policy and imprint are placeholders | `marketing/app/privacy/page.tsx:7`, `marketing/app/imprint/page.tsx:7` | Personal data cannot legally be collected from outside users yet. |
| Unsigned, un-notarized macOS app | `companion/package.json` `"identity": null`; README "Known limitations"; companion README notes that unsigned builds get a new code identity on every build | Gatekeeper warnings. Screen Recording and Accessibility permissions reset on each update. |
| Windows is not shipped | `package:win` exists but was never released or signed | Most DACH back-office desktops run Windows. |
| Teach on real apps cannot block the save | Pivot decision 2026-10-03 about 23:00: "Teach stops by voice on sight (no hard save-block)"; the sandbox ERP was removed | The Build Spec promise "catches it before it is saved" holds only if vision plus decide (up to `DECIDE_TIMEOUT_MS = 6000`) beat the learner's click. Spike c measured about 4.9 s per Haiku vision call. |
| Live e2e not confirmed | plan-log: 11/14 passed on df076de; the final rerun "from scratchpad/verify20" is listed as pending, with no result recorded | No recorded green end-to-end run on production. |
| Workspace switch "fixed" without a root cause | T-0271 changed only the test helper and closed the menu. Review T-0274 was `request_changes`: the test is vacuous and no cause was given. Merged by force under the deadline rule. | Possible cross-workspace confusion is adjacent to tenant isolation. |
| Usage caps raised for the demo | plan-log 11:40: VISION 20000, DECIDE 10000, WORKMAP 500, VOICE 300 per workspace per day (code defaults are 3000/2000/50/60, `src/lib/usage/index.ts`) | The production caps are demo-sized, so one workspace can spend real money. |
| Supabase free tier, built-in mailer | orchestrator gotchas 2026-10-04: template change refused on the free tier; switched to password login | No backups or PITR, project pause risk, rate-limited auth email, no OTP code email for the desktop app. |
| Invites send no email | `src/app/api/workspace/invites/route.ts:1` | The invitee has to know to sign up with the invited address. |
| Vercel deployment protection turned off | plan-log 2026-10-04 05:00 | Previews are public. Acceptable only while there is no customer data. |
| Shared ElevenLabs agents with per-session overrides | `scripts/create-agents.mjs`, `src/lib/voice/createAgents.ts` (default agent LLM `gemini-2.5-flash`, TTS `eleven_v3_conversational`) | One agent pair serves every customer, prompt changes go live for everyone at once, and raw voice reaches ElevenLabs and Google unredacted. |
| Jev (TypeSafe AI) decision layer | `src/lib/decide/jev.ts`; early-access API | An extra subprocessor. The LLM and heuristic fallbacks already cover it. |
| README team section `[team]`, stale comments | `README.md:179`; review T-0268 (`forwardedUser` "absent means completed") | Hygiene. |
| Not built | `.orchestrator/plan.md`: two-expert diff, German to English, frame redaction, MCP guardrail lookup; Scribe realtime pause signal | A German UI and German-language capture are needed for DACH. |

---

## 2. Product thesis

### 2.1 Target customer and job to be done

- **Buyer:** the head of finance operations, shared services or the controller in a DACH mid-market firm (200 to 5,000 employees) with a known knowledge cliff. The cliff can be a retirement, a parental leave, an outsourcing or an ERP migration. Champion: the team lead who loses three months each time someone leaves. Second buyer: HR or L&D for onboarding.
- **Job:** "Before Sabine leaves, get her judgment (the exceptions, limits and when-to-stop rules) into a form the next person can learn from and that I can audit, without taking weeks of her time."
- **Why now:** demographics, since baby boomers retire through about 2030. Also budget pressure on shadowing, and AI agents that need written guardrails before they can act.
- **What the customer buys:** a confirmed Work Map per process, built in about 1 to 2 hours of expert time instead of days of interviews. Then faster time to competence for each new hire.

### 2.2 Candidate positions

| # | Position | Buyer | Pro | Con |
| --- | --- | --- | --- | --- |
| A | **Expert knowledge capture** ("keep the judgment"): the Work Map with guardrails is the product, exported to the existing SOP or wiki. | Ops/finance lead, HR | Clear differentiation (*why*, not clicks). Capture works today. Teach can be added later. Event-driven sale (retirement). | Project-shaped demand, so a smaller recurring base unless processes stay living. |
| B | **Onboarding coach for back-office workflows**: live voice coaching and guardrail stops on the new hire's screen. | L&D, shared services | Recurring (every new hire), strong demo. | Competes with digital adoption platforms (WalkMe, Whatfix). Teach is the least reliable part (vision latency, no save block). Monitoring and works-council friction is highest here because the learner is watched. |
| C | **Guardrails for AI agents**: Work Maps become machine-checkable policies agents consult before acting (the README moonshot). | AI platform or automation team | Large if agents take over back-office work. Fits the agentic trend. | Too early. Needs a developer platform. No buyer budget yet in the mid-market. |

**Recommendation: A, with B as the expansion and C as the story.** Enter with capture: "one confirmed Work Map per process in under two hours of expert time". Price per process or per expert. Make Teach a beta add-on for design partners who want it, and make it the paid expansion once detection latency is solved. Keep C in the pitch and in the export format (structured guardrails as JSON and Markdown via `/api/export`) but build no platform for it.

### 2.3 Competitors and alternatives

Prices were checked on 2026-10-06. "Agg." means the figure comes from a third-party aggregator, not the vendor's page.

| Bucket | Who | What they do | Price | Why we win or lose |
| --- | --- | --- | --- | --- |
| Click-capture SOP tools | [Scribe](https://scribe.com/pricing), [Tango](https://www.tango.ai/pricing), [Guidde](https://www.guidde.com/pricing), [Loom](https://www.layerpath.com/compare/loom-cost) | Record clicks or video and produce step guides | Scribe $13 to $25/seat/mo; Tango $15 to $22/user/mo; Guidde $19 to $39 per creator/mo with free viewers; Loom $15 to $20 per creator (agg.). PII redaction and SSO only on enterprise tiers for Scribe and Tango. | They capture *what*, never *why* or the guardrails. They are cheap and self-serve, so we must not be priced or sold as "another SOP recorder". |
| SOP and training hubs | [Trainual](https://www.layer3labs.io/guides/trainual-pricing) (agg.), [Process Street](https://www.process.st/pricing/) | Written SOPs, checklists, training paths | Trainual $199 to $299/mo flat by headcount | A natural export target. They hold documents but do not create them from the expert. |
| Digital adoption platforms | [WalkMe (SAP)](https://www.vendr.com/marketplace/walkme), [Whatfix](https://getcor.ai/blog/reviews/whatfix-pricing), [Pendo](https://usetandem.ai/blog/pendo-vs-walkme-alternatives-2026), [Userlane (Munich)](https://produktly.com/pricing/userlane) | In-app walkthroughs authored by admins for SaaS apps | About $9k to $80k+/yr; Userlane about $12k to $50k+/yr (all agg.) | They prove budgets exist for onboarding inside apps. They need authoring, work best on web SaaS, and teach clicks rather than judgment. Teach competes here later. |
| Knowledge bases | [Guru](https://www.vendr.com/marketplace/guru), [Bloomfire](https://www.vendr.com/marketplace/bloomfire), [Tettra](https://www.docsie.io/vs/guru-vs-tettra-pricing/) | Searchable company knowledge | $8 to $45/user/mo | Same as hubs: a destination, not a capture method. |
| Tacit-knowledge AI (new) | [Interloom, Germany](https://www.eu-startups.com/2026/03/german-startup-interloom-lands-e14-2-million-seed-funding-for-ai-agent-knowledge-infrastructure/) ($16.5M seed, 2026-03), [Ethos](https://techcrunch.com/2026/05/06/ethos-raises-22-75m-from-a16z-for-its-expert-network-with-voice-onboarding/) (voice interviews, adjacent) | Context graph of expert know-how from tickets, email and transcripts, aimed at AI agents | n/a | **The closest funded analogue, in DACH.** It works from records, while we work from live work on screen plus voice. That validates the category and position C, and it means a funded competitor could add screen capture. |
| Task mining | [Skan.ai, Soroco, Mimica](https://kyp.ai/which-next-gen-process-intelligence-solution-is-right-for-you/), [Microsoft Power Automate](https://www.microsoft.com/en-us/power-platform/products/power-automate/pricing) (task mining in Premium $15/user/mo; Process Mining add-on $5k/tenant/mo) | Observe desktops to find automation candidates | Enterprise | Same sensor (screen plus activity), different job (automation, not people). Their trust and works-council playbooks are worth copying. |
| Screen-aware voice assistants | [Microsoft 365 Copilot Vision](https://blog-en.topedia.com/2026/06/vision-in-microsoft-365-copilot-screen-and-camera-sharing-on-desktop-and-mobile/) (rolling out 2026-06/07), [Gemini Live screen share](https://www.testingcatalog.com/google-tests-live-mode-with-screen-sharing-for-gemini-desktop/) (desktop unverified), [HeyClicky](https://github.com/farzaa/clicky) (macOS cursor tutor), [Screenpipe](https://toolradar.com/tools/screenpipe) ($21 to $42/mo, agg.) | General voice help that sees the screen | Bundled or cheap | **The commoditisation risk:** "a voice agent that watches your screen" will be a free feature in Microsoft 365. Our moat must be the method: the ask gate, the confirmed Work Map with the expert's own words, the guardrail rules, the teach-back loop, and DACH-grade privacy. |

Market signals: Switzerland expects about 297k retirements from 2024 to 2035 and a gap of about 460k workers by 2035 ([iamexpat summary of the study](https://www.iamexpat.ch/career/employment-news/switzerland-be-short-460000-workers-2035-study-finds)). Panopto's 2018 survey found that 42% of role knowledge is unique to the person, and estimated that inefficient knowledge sharing costs a large US firm $47M/yr ([PR Newswire](https://www.prnewswire.com/news-releases/inefficient-knowledge-sharing-costs-large-businesses-47-million-per-year-300681971.html)). Digital adoption platform market estimates range from $0.9B (2025) to several billion by 2030 to 2034 ([IMARC](https://www.imarcgroup.com/digital-adoption-platform-market)). These are vendor-style numbers, so use them for direction only.

### 2.4 Pricing models seen in the category

| Model | Examples | Fit for us |
| --- | --- | --- |
| Per creator, viewers free | Guidde $19 to $39, Loom $15 to $20, Tango Pro | Good analogue: experts are creators and learners are viewers. Per-creator prices of $15 to $40 are too low for our cost per capture hour (section 3.7), unless usage is capped. |
| Per seat with a minimum | Scribe Pro Team (5 seats), Tettra (10 users) | Simple, but it charges for learners who rarely use it. |
| Flat tier by headcount | Trainual $199 to $299/mo | Easy for SMBs. Does not track our variable cost. |
| Annual platform contract | WalkMe, Whatfix, Pendo, Userlane, Tango Enterprise: about $10k to $80k+/yr | The budget line we want: onboarding and knowledge retention for a department. |
| Consumption | Userlane per interaction, Power Automate per bot ($150/bot/mo) and per tenant ($5k/mo) | Use as a guardrail on cost (included minutes, overage), not as the headline. |

**Proposed shape (to validate in Phase 1):** an annual workspace platform fee that includes a number of captured processes and voice minutes. Experts and learners are free in Capture. Teach is an add-on per active learner. Design partners pay a small fixed pilot fee that is credited against year one. Decision 5.7 has the numbers.

---

## 3. Gap analysis, hackathon to product

Severity: **Critical** blocks any external user. **High** blocks the paid launch or puts design partners at risk. **Medium** fix during the beta. **Low** hygiene.

### 3.1 Reliability and correctness

| Gap | Severity | Evidence / note |
| --- | --- | --- |
| No recorded green end-to-end run on production, and nothing proven on a real customer ERP | High | Live e2e reached 11/14 on df076de and the final rerun is pending. The 11:05 analysis said "all modules exist ... nothing proven end to end". |
| Workspace switch root cause unknown, tests vacuous | High | Review T-0274: the `x-middleware-request-cookie ?? jar.header` assertion passes either way. The real cookie and refresh path in `src/proxy.ts` is untested. |
| Teach detection latency: vision (about 4.9 s on Haiku, spike c) plus decide (timeout 6 s) against the learner's click. No save hook on real apps | High | `src/lib/teach/intervention.ts:13`. This is the core promise of Module 3. |
| Vision accuracy on real business apps (SAP GUI, Abacus, Bexio, DATEV, Excel) not measured | High | The only vision evidence is the spike and the demo flows. |
| Idle-capture cron: `supabaseIdleCapturePort` untested against real columns, 3 queries per open session with no batch cap | Medium | Review T-0270 (2x med). A wrong column means a 502 on every run and sessions shown as "live" forever. |
| T-0268 lows: the partition test only greps `main.mts`. Desktop users must sign in again after the `persist:apprentice` change. The `forwardedUser` contract comment is stale, and mixing old and new payloads within the 30 s TTL is unconfirmed | Low/Medium | `companion/src/window.test.ts:140`, `companion/src/main.mts:986`, `src/lib/auth/forwardedUser.ts:64`, `src/lib/auth/context.ts:30,240` |
| SQL and RLS are verified only by manual checks: "The gate runs no database" | High | `.orchestrator/plan.md` item 8. There is no automated test against real Postgres. |
| Auth throttle is in-memory per serverless instance | Medium | `src/lib/auth/throttle.ts:1` |
| Two merges were forced under the deadline rule (T-0264 sign-in, T-0271 switch). Med and low review findings were deferred | Medium | plan-log 12:55 and 13:55. Needs a sweep of the deferred findings. |
| Code built by agents in 20 hours with many fix rounds | Medium | A one-week human code-health audit before outside data arrives is cheap insurance. |
| The Work Map rebuild runs under the 60 s function limit with a 40 s synthesis budget and a fallback | Medium | `src/lib/workmap/rebuild.ts`. Long sessions will hit the fallback, so large captures need background jobs. |

### 3.2 Security and privacy

| Gap | Severity | Evidence / note |
| --- | --- | --- |
| **Frames unredacted**: full-monitor JPEGs (up to 1600 px wide, quality 0.7) go to Anthropic and are stored in Supabase Storage | Critical | `src/app/api/vision/route.ts` (save, then `describeFrame`), `src/lib/perception/frame.ts`. Text redaction happens only after vision. |
| **Whole monitor captured**, no app or window allowlist | Critical | `src/lib/perception/capture.ts`. Other apps, notifications and chats are captured. |
| Raw voice goes to ElevenLabs and to the agent LLM (Gemini 2.5 Flash via ElevenLabs) with no redaction and no retention setting in the agent config | High | `src/lib/voice/createAgents.ts:11-13`. No retention or zero-retention field is set (grep found none). |
| Transcripts, events and Work Maps have no retention. Only frames expire (default 90 days, options 7/30/90/365) | Medium | `src/lib/agents/settings.ts:11,55`. Retention covers `session_frames` only. |
| Tenant isolation rests on RLS on 15 tables plus two service-role paths (member emails on /workspace, the cron), with no automated cross-tenant tests | High | `supabase/migrations/*`, plan.md item 9. |
| Redaction recognizers are regex-based (names, emails, IBAN, phone, cards). There is no Swiss AHV number and no address recognizer, and name detection is heuristic | Medium | `src/lib/redact/index.ts` |
| Global input hook (`uiohook-napi`) reads key events. It keeps counts only, and chord detection reads keycodes | Medium | `companion/src/activity.mts`. Security reviewers will ask, so document it and keep the boundary tested. |
| Electron app URL and origin trust: an earlier wildcard origin incident (T-0126) was fixed with exact origins | Low (keep guarded) | orchestrator gotchas 2026-10-04 |
| No SSO or SAML, no enforced MFA, no audit log of admin actions | Medium (beta) / High (paid) | Supabase TOTP is enabled but optional. |
| Public repo while the product is commercial | Medium | Decide whether to make it private, or to keep it open and accept clones. The release repo is public by design. |

### 3.3 Compliance (Switzerland nFADP, EU GDPR, works councils, AI Act)

Not legal advice. Every item needs a Swiss data-protection lawyer, and one familiar with German labour law before selling in Germany.

| Topic | Severity | Gap and what is needed |
| --- | --- | --- |
| Roles and DPA | Critical | The customer is the controller and AI Apprentice is the processor. A DPA is needed (nFADP Art. 9; GDPR Art. 28), with a subprocessor list: Supabase (eu-central-2 Zurich), Vercel (fra1, US company), Anthropic (US), ElevenLabs (US), Google (Gemini as the agent LLM via ElevenLabs), TypeSafe/Jev when enabled. None of this exists. |
| Duty to inform and transparency | Critical | Privacy policy, an in-app notice before each capture and teach session, a visible recording indicator (the dock and halo exist), and an explicit "AI is listening" disclosure for the voice agent. Consent alone is a weak legal basis in employment, so rely on legitimate interest plus transparency and the customer's internal rules. |
| Cross-border transfers | High | Model and voice calls leave Switzerland and the EU. The Swiss-US DPF has been in force since 2024-09-15, but only covers DPF-certified recipients ([Walder Wyss](https://www.walderwyss.com/en/news/2024-08-14_federal-council-swiss-us-data-privacy-framework-in-force-on-15-september-2024)). Check each vendor's certification (unverified) or use SCCs plus a transfer assessment. Data at rest is already in Zurich, which is a selling point once the processing also stays in the EU or Switzerland. |
| DPIA and records of processing | High | Screen plus voice of employees with new technology means a DPIA (nFADP Art. 22; GDPR Art. 35). Records of processing are mandatory from 250 employees or for high-risk processing ([swissstaffing factsheet](https://www.swissstaffing.ch/docs/en/Legal-Counsel/Factsheets/20230308-merkblatt-datenschutzgesetz-revdsg-en.pdf)). Ship a DPIA template that customers complete. nFADP fines go up to CHF 250k and are levied on the responsible individual. |
| Breach notification | High | Notify the FDPIC "as soon as possible" for high-risk breaches (nFADP), and inform the controller without undue delay under GDPR. Needs a runbook, logs and contacts (P2-4). |
| Employee monitoring (Switzerland) | High | ArGV 3 Art. 26 forbids systems meant to monitor employee behaviour. Commentators list AI evaluation of screen activity and app logs as possible violations ([SEV](https://sev-online.ch/de/deine-rechte/link_zum_recht/2025/darf-mein-arbeitgeber-berwachungssysteme-einsetzen-202510-86172/), [FDPIC](https://www.edoeb.admin.ch/de/technische-mittel-zur-uberwachung-am-arbeitsplatz)). Capture is expert-initiated and purpose-bound (knowledge transfer). Teach watching a learner and producing a mastery summary is the risky part. Design rule: the learner starts sessions, results are private to the learner by default, managers see no per-person performance, no key content is kept, frames are ephemeral. |
| Works councils (Germany) | High for DE sales | BetrVG §87(1) no. 6: co-determination applies to any system *suitable* for monitoring, regardless of intent ([anwalt.de](https://www.anwalt.de/rechtstipps/mitbestimmungsrecht-des-betriebsrats-bei-der-einfuehrung-technischer-ueberwachungseinrichtungen-87-abs-1-nr-6-betrvg-232654.html)). Expect a works agreement per German customer. Provide a template and a technical fact sheet. Start in Switzerland to shorten early sales cycles. |
| Recording third parties | High | Customers, suppliers and colleagues appear on screen, and calls can be overheard. The Swiss Criminal Code (Art. 179bis/ter, verify with counsel) covers recording non-public conversations without consent. Needs capture scope (P0-7), redaction (P1-1), a "no calls or meetings during capture" rule, and auto-pause when a known call app is frontmost (the desktop app knows the frontmost app). |
| EU AI Act | Medium now / High by 2027-12 | Annex III point 4 makes systems that monitor or evaluate workers high-risk. Those obligations are now pushed to 2027-12-02 by the Digital Omnibus ([Gibson Dunn](https://www.gibsondunn.com/eu-ai-act-omnibus-agreement-postponed-high-risk-deadlines-and-other-key-changes/)). Emotion recognition at work has been banned since 2025-02-02 ([William Fry](https://www.williamfry.com/knowledge/the-time-to-ai-act-is-now-a-practical-guide-to-emotion-recognition-systems-under-the-ai-act/)), so the voice agent must never infer stress or mood. Keep mastery as learner self-feedback, not an HR evaluation, to stay out of Annex III. |
| Retention and data subject rights | Medium | Only frames expire (default 90 days). Transcripts, events, Q&A and Work Maps are kept indefinitely. There is no export-my-data. Agent delete cascades exist (migration `20261004060000_agent_delete_cascade.sql`). Needs per-workspace retention for all data, user and workspace deletion, and backup retention stated in the DPA (P1-8). |
| Regulated customers | Medium | Banks and insurers (FINMA) bring outsourcing requirements (verify the current FINMA outsourcing rules). Avoid them in the beta. |

### 3.4 Desktop distribution

| Gap | Severity | Note |
| --- | --- | --- |
| macOS signing and notarization (Developer ID, hardened runtime already on, entitlements file exists) | Critical | `companion/package.json` `identity: null`. Needs an Apple Developer Program membership and the founder's account. |
| Auto-update | High | No `electron-updater`. Without it every fix means a manual dmg download and new permission grants. |
| Windows build: native modules (`uiohook-napi`, `get-windows`), NSIS target exists, no signing | High for DACH back-office | Bridge for the beta: the web app already runs Capture in Chrome via `getDisplayMedia` (transport `none`). Validate that path on Windows first. |
| Stable code identity, so TCC permissions survive updates | High | Solved by signing with one Developer ID. |
| Crash reporting for the desktop app | Medium | None today. |

### 3.5 Onboarding

| Gap | Severity | Note |
| --- | --- | --- |
| No custom SMTP. The Supabase built-in sender is rate-limited, and OTP code email for desktop sign-in is not possible on the free tier | High | orchestrator gotchas 2026-10-04 |
| Invites send no email | Medium | `src/app/api/workspace/invites/route.ts` |
| macOS permission setup (Screen Recording, Accessibility, Input Monitoring) is the biggest drop-off risk | High | An onboarding flow with a permission step exists (`src/lib/onboarding/`). Measure completion. |
| First capture has no guided practice task. The sample map exists only for Teach | Medium | Add a 5-minute "train it on something harmless" walkthrough. |
| UI and voice are English only | High for DACH | The German path was cut. Experts explain best in their own language (de-CH). |

### 3.6 Observability

| Gap | Severity | Note |
| --- | --- | --- |
| No error tracking (web, API, Electron), no log drain, no alerting. Only `console.error` | High | grep found no Sentry, PostHog or analytics. |
| No product analytics or funnel (signup to first confirmed Work Map) | High for the beta | Needed to learn from design partners. Use an EU-hosted, cookie-light tool. |
| No cost telemetry. `usage_counters` counts calls, not tokens, minutes or CHF | High | Needed for pricing and abuse control. |
| No cron or uptime monitoring | Medium | The retention cron can fail silently (502 in the answer only). |

### 3.7 Costs

**Usage pattern in the code:**
- **Vision:** one Claude Haiku 4.5 call per *changed* frame. The screen is sampled every 1.5 s, frames are up to 1600 px wide at JPEG quality 0.7, and each call has `max_tokens` 800 (`src/lib/perception/capture.ts`, `frame.ts`, `vision.ts:148-149`).
- **Voice:** an ElevenLabs agent stays connected for the whole Capture, Debrief and Teach session. The agent LLM defaults to `gemini-2.5-flash`.
- **Decisions:** Haiku, `max_tokens` 400, for event classification, scoring and the Teach fallback.
- **Work Map:** Opus 5.5, `max_tokens` 8000. It is synthesised in full once, then rescored or rebuilt during the debrief.
- **Storage:** every stored frame goes to Supabase Storage.

**Unit prices** (checked 2026-10-06):
- ElevenLabs Agents: $0.08/min overage on all plans, cut from $0.10 on 2026-05-07 ([ElevenLabs](https://elevenlabs.io/pricing/api)). The LLM is billed on top.
- Claude Haiku 4.5: $1/$5 per M tokens in/out. Opus 5.5: $4/$20 ([Anthropic](https://platform.claude.com/docs/en/about-claude/pricing)).
- Image tokens: about w×h/784, capped near 1,600 tokens for Haiku ([vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)).
- Supabase Pro: $25/mo, 100 GB of storage included ([Supabase](https://supabase.com/pricing)).
- Vercel Pro: $20 per seat per month ([Vercel](https://vercel.com/pricing)).

**Rough cost model (estimates; P0-10 replaces them with measured numbers):**

| Item | Assumption | Cost |
| --- | --- | --- |
| Vision | 10 to 30 changed frames/min (24 typical). About 1,600 image tokens plus 1,200 prompt tokens in, about 250 out, so about $0.004 per call. | $2.40 to $7.20 per hour (typical about $5.80) |
| Voice | Connected the whole session, $0.08/min plus about $0.005/min for the agent LLM | about $5.10 per hour |
| Decide | 2 to 6 Haiku calls/min at about $0.002 | about $0.50 per hour |
| Work Map | 30k tokens in and 6k out per full synthesis at Opus 5.5 prices is about $0.24. Assume 3 full syntheses per session. | about $0.75 per session |
| Storage, egress, functions | about 300 MB of frames per capture hour, kept 90 days. About 1,500 short function calls per hour. | under $0.10 per hour |
| **Capture hour, including debrief** | | **about $11 (range $8 to $14)** |
| **Teach hour** | vision plus voice plus decide | **about $10** |

**Per user per month (example):**
- An expert captures 2 processes at about 1 hour each, about $22.
- A new hire does 4 Teach hours in the first month, about $40, and close to $0 after onboarding.
- One confirmed process, including a second pass, costs about $15 to $25 in variable cost.

**Fixed monthly costs:**
- Supabase Pro $25, Vercel Pro $20 per seat, an ElevenLabs plan (Pro $99 including 1,238 min).
- Email provider about $15, error tracking $0 to $30, Apple $99/yr, Windows signing about $10/mo ([itechguides](https://www.itechguides.com/products/azure-artifact-signing/), primary page unverified).
- Total roughly $200 to $250/mo before the first customer.

**Implications:**
1. Seat prices of $15 to $40 (the Scribe or Guidde level) do not cover heavy Teach use. Price per workspace or per process, with included minutes.
2. The biggest levers are fewer vision calls (adaptive cadence, smaller frames, local diff on the focused region, prompt caching for the fixed prompt) and voice minutes (push-to-talk, or disconnecting the agent during long silent stretches). P1-10 targets a 40% cut.
3. Keep `consume_usage` caps per plan, and alert on spend per workspace (P0-5). The current production caps (VISION 20000 per day) allow about $80/day of vision per workspace.

### 3.8 Billing and support

| Gap | Severity | Note |
| --- | --- | --- |
| No billing, plans, trials or invoices (CHF and EUR, VAT) | High (Phase 2) | Nothing in the repo. Stripe supports CHF and Swiss VAT invoices. |
| No support channel, help docs, status page or incident process | Medium (beta) / High (paid) | Design partners need a direct line, such as a shared Slack or Teams channel. |
| No terms of service, DPA or SLA | Critical before any outside user | Ties into section 3.3. |
| No legal entity: the imprint says "follows before launch" | Critical before paid | Founder decision 5.6. |

---

## 4. Phased roadmap

Each goal below can be filed as one orchestrator goal: title, outcome, one-line acceptance, size (S up to about 2 days, M up to about 1 week, L more than 1 week), and dependencies. **[H]** marks goals that are mostly human or founder work (accounts, legal, partners). The orchestrator can prepare drafts for these but cannot finish them.

### Phase 0: Stabilise (2 weeks, from 2026-10-07 to 2026-10-20)

Goal: a build that can be put in front of a friendly outsider without embarrassment or legal exposure, plus a measured cost per session.

| ID | Title | Outcome | Acceptance (one line) | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| P0-1 | Staging environment and DB-backed tests | A second Supabase project and Vercel env for staging. RLS and SQL tests run against real Postgres in CI. | CI runs a cross-tenant suite (user A cannot read or write any of the 15 tables or the frames of workspace B) against a local or staging Postgres, and it is green. | M | none |
| P0-2 | Workspace switch root cause | The production failure is reproduced and fixed with a test that fails before the fix. | A test using real cookie parsing and the `src/proxy.ts` refresh path fails on 3462a9b and passes after the fix. Live e2e steps 07 and 13 are green. | S | P0-1 |
| P0-3 | Deferred review findings sweep | The T-0268, T-0270 and T-0274 med/low findings and stale comments are closed. | Behavioural partition test, idle-capture port tested against the fake Supabase with a batch cap, `forwardedUser` contract documented and tested, each finding linked to a commit. | S | none |
| P0-4 | Live e2e green on staging, nightly | The `e2e:live` suite runs on a schedule against staging with a test user. | 14/14 green on two consecutive nightly runs, with the summary posted where the founder sees it. | M | P0-1, P0-2 |
| P0-5 | Observability baseline | Error tracking for web, API and Electron (EU region), structured server logs, and a cost meter per workspace (tokens, voice minutes, frames). | A forced error in each of the 3 surfaces shows up within 1 minute. A daily cost per workspace in CHF is queryable. | M | none |
| P0-6 | Paid infra tiers and email [H] | Supabase Pro (backups, no pause), custom SMTP, Vercel Pro (commercial use), demo-sized caps reset to defaults. | Daily backups visible, OTP and invite emails delivered from the product's domain, `USAGE_CAP_*` at defaults or set per plan. | S | none |
| P0-7 | Capture scope and frame minimisation v1 | Capture one chosen app or window instead of the whole monitor. Frames are held in memory for vision and not stored, except key moments referenced by a confirmed Work Map step. Default frame retention 30 days. | With the defaults, a 10-minute capture stores at most N frames (N = referenced moments) and no frame shows a window outside the chosen app. | M | none |
| P0-8 | macOS signing, notarization, auto-update [H for the Apple account] | A Developer ID signed and notarized dmg with `electron-updater` from GitHub releases. | A fresh Mac opens the dmg without a Gatekeeper warning, and an update from v0.2.0 to v0.2.1 keeps the Screen Recording permission. | M | Apple Developer account |
| P0-9 | Legal minimum [H, lawyer] | Real privacy policy, imprint, terms, subprocessor list, DPA template and a beta participation agreement. | The pages are live on the marketing site, with no placeholder text in `marketing/app/privacy` or `imprint`. | S (code) / M (legal) | Decision 5.6 |
| P0-10 | Measured unit cost | 10 scripted sessions (5 capture plus debrief, 5 teach) on staging with the cost meter. | The cost per capture hour and per teach hour is recorded with min, median and max, compared with section 3.7. | S | P0-5 |
| P0-11 | Model retirement check | Confirm the retirement date of `claude-haiku-4-5-20251001` (memory note: "retires not before 2026-10-15") and set tested `VISION_MODEL` and `DECIDE_MODEL` fallbacks. | The vision and decide test suites pass on the chosen successor model, which is set in the Vercel env, and a dated note records the switch. | S | none |
| P0-12 | Demo residue cleanup | Remove the "Sabine" default, gate the fixture, preview and `__audit` routes out of production builds, and reset the usage caps. | No route under `/preview` or `/__audit` answers 200 in production, and a capture without an expert name asks for one. | S | none |

**Phase 0 success metrics:** zero Critical gaps open except true frame redaction (P1-1). Live e2e 14/14 on two consecutive nights. Signed dmg installs cleanly. Error tracking is live on all surfaces. Cost per capture hour is measured, not estimated.

### Phase 1: Private beta with 5 to 10 design partners (about 8 weeks, from 2026-10-21 to 2026-12-15)

Goal: prove that experts in real firms produce Work Maps that a new person can use, and that the firm will pay for it.

| ID | Title | Outcome | Acceptance (one line) | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| P1-1 | Frame redaction on device | OCR the frame locally (desktop app; browser fallback) and blur PII regions (names, emails, IBAN, AHV, amounts optional) before upload, with recognizers shared with text redaction. | On a fixture set of 50 business screenshots, recall of seeded PII is at least 95% and no unredacted fixture PII reaches the vision request. | L | P0-7 |
| P1-2 | Voice privacy and agent isolation | ElevenLabs zero-retention or the shortest retention, EU residency if available, one agent pair per environment, versioned prompts, and an agent LLM choice documented as a subprocessor. | The agent config shows the retention setting. Staging and production agents are separate. A prompt change ships through the `create-agents --update` flow with a version tag. | S | P0-6 |
| P1-3 | German capture and UI | German (de-CH tolerant) interviewer and tutor prompts, German UI strings, German Work Map output. | A German capture produces a German Work Map with reasons quoted verbatim, and all UI strings are in a locale file. | M | none |
| P1-4 | Real-ERP vision benchmark and tuning | A labelled set of real-app sessions (SAP GUI, Abacus or Bexio, Excel, Outlook) and an accuracy and latency harness for `describeFrame`. | The harness reports event precision and recall and p50/p95 latency. Field-change recall is at least 85% on the set. | M | design partner data under DPA |
| P1-5 | Teach latency and honesty | Measure detect-to-speak latency. Add faster local signals (frame diff on the focused field region, accessibility API values on macOS). Present Teach as "coach" with explicit "I was late" handling. | p95 from a guardrail-breaking edit to the spoken stop is under 3 s on the benchmark, and late catches are flagged in the mastery summary. | L | P1-4 |
| P1-6 | Windows path | Browser capture validated on Windows Chrome and Edge for Capture, Debrief and Teach. A signed Windows build follows if partners need the buddy. | A Windows 11 machine completes capture to confirmed Work Map in the browser with no desktop app. | M (browser) / L (signed app) | P0-4 |
| P1-7 | Work Map export and living process | Export to PDF, DOCX or Markdown, and to Confluence or SharePoint pages, plus a change-review flow when a second expert corrects a step. | One click exports a confirmed process with guardrails and screen moments, and a correction creates a new version with a diff. | M | none |
| P1-8 | Admin, data rights and audit log | Workspace admin role, export-my-data, delete-my-data (user and workspace), and an admin audit log. | An admin can export and delete a user's data, and the audit log records invites, role changes, deletions and settings changes. | M | P0-1 |
| P1-9 | Onboarding v2 | Invite emails, a permission wizard with live checks, and a 5-minute guided first capture on a harmless task. | In the funnel, at least 70% of invited experts reach a first confirmed Work Map within 7 days. | M | P0-5, P0-6 |
| P1-10 | Cost reduction pass | Adaptive frame cadence (slower when idle, faster on field edits), smaller frames, prompt caching, push-to-talk voice by default during capture. | Measured cost per capture hour drops by at least 40% compared with P0-10, with no drop in the P1-4 accuracy. | M | P0-10, P1-4 |
| P1-11 | Compliance pack [H with counsel] | DPIA, records of processing, TOMs, a works-council and employee information pack, and a consent and notice flow in the app. | The pack is shared with every design partner before their first capture, and each partner has a signed DPA. | M | P0-9 |
| P1-12 | Design partner programme [H] | 5 to 10 partners with a named process each, a shared support channel, weekly check-ins and an in-app feedback button. | Each partner has captured at least one process and given a rating, and the founder writes a weekly learning log. | ongoing | P0 done |

**Phase 1 success metrics:**
- Signed partners: at least 5 with a DPA. At least 3 complete capture to confirmed Work Map on a real process.
- Expert time to a confirmed Work Map: median under 90 minutes of their time.
- Work Map quality: an expert rating of at least 4/5 that it is "correct and complete enough to hand over". A novice can execute the process from the Work Map with at most 1 guardrail breach in a test case.
- Teach (where piloted): at least 2 partners. Guardrail catch rate at least 80% on seeded mistakes. p95 stop latency under 3 s.
- Commercial: at least 3 partners say yes to a paid continuation at the proposed price (LOI or order).
- Trust: zero privacy incidents, and no works-council objection that blocks a pilot.

### Phase 2: Paid launch (about 8 weeks, from 2026-12-16 to 2027-02-15)

Goal: convert design partners and sign the first new paying customers without the founder in every step.

| ID | Title | Outcome | Acceptance (one line) | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| P2-1 | Billing and plans | Stripe in CHF and EUR, VAT, plans with included processes and minutes, trials, and usage metering from the cost meter. | A new workspace can start a trial, upgrade, get an invoice, and hit plan limits with a clear upgrade prompt. | M | P0-5, decision 5.7 |
| P2-2 | SSO and enterprise auth | SAML or OIDC SSO (Supabase SSO), enforced MFA option, domain capture. | A test IdP (Entra ID) user signs in through SSO and is placed in the right workspace by domain. | M | P1-8 |
| P2-3 | Self-serve signup and in-product trial | Public signup, guided first capture, pricing page, and a trial-to-paid funnel. | A stranger reaches a confirmed Work Map without talking to the founder, and the funnel is measured. | M | P1-9, P2-1 |
| P2-4 | Support and status | Help centre, in-app contact, status page, incident runbook, and an on-call rule for one person. | The status page is live, the runbook is tested once with a staged outage, and the support first-response target is published. | S | P0-5 |
| P2-5 | Security assurance [H, external] | An external penetration test of web, API and desktop, a security whitepaper, and a vendor questionnaire answer bank. | Pen-test highs are fixed and the whitepaper is published for prospects. | M | P1-1, P1-8 |
| P2-6 | Windows desktop GA (if Phase 1 showed demand) | A signed Windows installer with auto-update. | A Windows 11 machine installs without a SmartScreen block on a signed build and updates in place. | L | P1-6 |
| P2-7 | Teach GA | Teach sold as an add-on once P1-5 metrics hold for 4 weeks. | Teach metrics hold on 3 or more customers, and the mastery summary is private to the learner by default. | M | P1-5, P1-11 |
| P2-8 | Guardrails export for agents (moonshot seed) | A stable JSON schema and API for confirmed guardrails per process, and an MCP server that reads it. | An agent framework can fetch the guardrails for a process via API or MCP with a workspace token. | M | P1-7 |

**Phase 2 success metrics:** at least 5 paying customers. MRR target set in decision 5.7, for example CHF 5k to 10k by 2027-03-31. Gross margin at least 70% after model and voice costs. Activation (signup to confirmed Work Map) at least 40% for self-serve trials. Logo churn 0 in the first quarter. Support first response under 1 business day.

---

## 5. Decisions the founder must make

1. **Position and first vertical.**
   - Options: (A) expert knowledge capture; (B) onboarding coach; (C) guardrails for AI agents.
   - Vertical options: finance back-office (AP/AR/controlling), manufacturing or field-service operations, insurance claims.
   - **Recommendation:** A, in finance back-office at DACH mid-market firms that FINMA does not supervise, starting in Switzerland. The demo, the Work Map vocabulary (cost centre, capex, approval limits) and the limit-rule parser (`src/lib/teach/intervention.ts`) all already fit it.

2. **Teach in the beta.**
   - Options: full Teach for everyone; Capture only; Teach as an opt-in "practice mode".
   - **Recommendation:** opt-in practice mode. The learner starts it, results are private to the learner, and there is no manager scoreboard. This lowers both the reliability risk (vision latency) and the monitoring risk (ArGV 3 Art. 26, BetrVG). Sell Teach only after P1-5 holds.

3. **Frame policy.**
   - Options: store every frame (evidence and replay); store only redacted key moments referenced by confirmed steps; never store frames.
   - **Recommendation:** key moments only, redacted, with 30-day retention for anything unreferenced. Replay of the expert's screen moment is part of the value. A full archive is liability without value.

4. **Model and voice providers, and data residency.**
   - Options: (a) Anthropic and ElevenLabs direct under the DPF or SCCs; (b) Claude through an EU cloud region, with the exact model availability unverified; (c) EU-hosted alternatives.
   - **Recommendation:**
     - For the beta, choose (a) with each vendor's DPA, the shortest retention or zero retention, and a published subprocessor list.
     - Drop Jev from the default path.
     - Consider switching the ElevenLabs agent LLM from Gemini to a model from a vendor already on the list, so there is one subprocessor fewer, if the latency holds.
     - Price out (b) before Phase 2. "Processed in the EU, stored in Zurich" is a sales argument in DACH.

5. **Desktop strategy.**
   - Options: Electron-first on macOS and Windows; browser-first, with the desktop app as the premium layer; browser only.
   - **Recommendation:** browser-first for Capture, Debrief and Teach, because it works on Windows today. The desktop app is for macOS power users (buddy, dock, push-to-talk). Build a signed Windows desktop app only if at least 3 design partners ask for it.

6. **Legal entity, name and domain.**
   - Entity options: sole proprietorship; GmbH (CHF 20k capital); AG.
   - Name options: keep "AI Apprentice" or rename.
   - **Recommendation:**
     - Form a GmbH before signing DPAs with paying customers. Customers expect a company counterparty, and the imprint needs one.
     - Rename before beta invites go out. "AI Apprentice" is generic, hard to trademark, and `ai-apprentice.vercel.app` already belongs to a third party (orchestrator gotchas 2026-10-04).
     - Run a 30-minute trademark search (Swissreg, EUIPO), then buy a .ch and a .com domain. Moving off `apprentice.kentawaibel.com` is cheap now and expensive later.

7. **Pricing and the beta deal.**
   - Options: per seat; per creator with free learners; platform fee plus processes; pure usage.
   - **Recommendation:**
     - Design partners pay a fixed pilot fee of about CHF 1,500 to 3,000 for 3 months, credited against year one. It filters out tourists.
     - Hypothesis for launch: an annual workspace fee of about CHF 6k to 15k/yr that includes about 10 processes and a voice-minute budget. Teach is an add-on per active learner.
     - Validate in Phase 1. The goal is at least 70% gross margin at the measured cost per hour.

8. **Public or private repo.**
   - Options: keep public; make it private; open-core.
   - **Recommendation:** make the app repo private now. Prompts, the ask gate and the Work Map pipeline are the product. Keep the release repo for the desktop app public.

9. **Team and build mode.**
   - Options: solo founder with the orchestrator; add a commercial cofounder or advisor; contractors.
   - **Recommendation:**
     - Find a commercial partner with a finance-ops network in Swiss mid-market firms. Phase 1 is mostly sales and partner work, not code.
     - Keep the orchestrator for building, and add one human code-health review before outside data arrives.
     - Decide whether the hackathon teammates (README "[team]") stay involved, and settle IP assignment in writing.

10. **Infra spend now.**
    - Options: stay on free tiers until revenue; pay about $200 to $250/mo now.
    - **Recommendation:** pay now (P0-6). The free tier has no backups and can pause projects, and Vercel Hobby is for non-commercial use.

---

## 6. Risks and the cheapest test for each

| # | Risk | Likelihood / impact | Cheapest test | Pass signal |
| --- | --- | --- | --- | --- |
| 1 | No urgent budget: knowledge retention is "important, not urgent" | High / fatal | 15 discovery calls in 3 weeks with finance-ops leads at Swiss firms of 200 to 5,000 employees, using the demo video and a one-page offer | At least 3 paid pilots or LOIs at CHF 1.5k or more |
| 2 | Experts refuse to be recorded, or a works council or DPO blocks it | Medium / high | Show the consent flow, capture scope and a one-page privacy summary to 3 HR, DPO or works-council people | No hard blocker. The list of conditions feeds P1-11. |
| 3 | Vision misreads real ERPs (SAP GUI, Abacus, Bexio, Excel) | Medium / high | One day: 30 to 50 real-app screenshot pairs (demo systems or a partner's test system), run `describeFrame` offline, label by hand | Field-change recall at least 85%, and no hallucinated values in the guardrail fields |
| 4 | Teach catches mistakes too late to matter | High / medium | 20 seeded guardrail violations on staging, timing each from edit to spoken stop | p95 under 3 s. If not, keep Teach as review or practice, not live stop. |
| 5 | Work Maps are not good enough to hand over | Medium / fatal | Give one confirmed Work Map to someone who has never done the task. They handle 3 new cases while you watch, with no help. | At most 1 guardrail breach, and the expert rates the map at least 4/5 |
| 6 | Unit economics: about $10/h in variable cost eats the margin | Medium / high | P0-10: 10 metered sessions | Measured cost fits a price with at least 70% gross margin at expected usage |
| 7 | Commoditisation by Microsoft 365 Copilot Vision, Gemini, or Scribe/Guidde adding "ask why" | High / medium | A 2-hour trial of Copilot Vision and Scribe on the Sabine task, noting what they cannot do. Repeat every quarter. | They still produce no confirmed reasons and guardrails and no teach-back. Sharpen the pitch on that gap. |
| 8 | A funded DACH competitor (Interloom) moves into screen capture | Medium / medium | Read their product and hiring pages monthly, and ask design partners whether they have heard of them | Differentiation holds (live work plus voice versus records) |
| 9 | Provider change: Haiku 4.5 retirement, ElevenLabs pricing or terms | High (Haiku) / medium | P0-11: run the vision and decide suites on the successor model now | Green on the successor, with the env switched before the retirement date |
| 10 | Privacy incident: cross-tenant read, frame leak, PII in a support screenshot | Low to medium / fatal | P0-1 cross-tenant suite, a one-day internal threat model, external pen test before Phase 2 | No high findings open at launch |
| 11 | Learners feel watched, so Teach is rejected | Medium / medium | 3 new hires try practice mode, then answer "felt watched?" (1 to 5) and "would use again?" | Median 2 or lower on "felt watched", and at least 2 of 3 would use it again |
| 12 | Naming or trademark conflict after launch | Medium / medium | 30-minute Swissreg and EUIPO search on the current and candidate names | A clear class-9/42 path for the chosen name |
| 13 | Founder bandwidth: one person doing sales, compliance and product | High / high | Track hours weekly in Phase 1 | At least 40% of hours on partners and sales. Otherwise cut scope (Windows, Teach) first. |
| 14 | Code built in 20 hours by agents hides defects (forced merges, deferred findings) | Medium / medium | P0-3 sweep plus a one-week human review of auth, RLS, store and the vision route | No high findings left open |

---

## Appendix A: post-hackathon list from the status notes, mapped to goals

| Item (plan-log 2026-10-04) | Goal |
| --- | --- |
| Workspace switch root cause (review T-0274) | P0-2 |
| T-0268 lows: partition test greps only, re-sign-in after `persist:apprentice`, stale `forwardedUser` comment | P0-3 (and a release note for the re-sign-in) |
| Frame redaction | P0-7 (minimise), P1-1 (redact) |
| Code signing | P0-8 |
| Windows build | P1-6, P2-6 |
| goal/T-0001 lacks the README team commit; `[team]` placeholder | Hygiene, not a goal |
| Delete scratchpad verify copies and the mainmerge worktree | Housekeeping (needs approval, since it deletes) |
