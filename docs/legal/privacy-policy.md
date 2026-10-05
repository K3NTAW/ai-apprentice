# Privacy policy (DRAFT)

> UNPUBLISHED DRAFT. Not reviewed by a lawyer. Not legal advice. See [README](README.md).

Last updated: [date]

This policy explains how [product name] ("we") processes personal data when a team uses [product name] at [domain] and in the desktop app.

## 1. Controller

[entity to be founded], Switzerland
[address]
Contact: [privacy contact address]

For data that a workspace records about its own work (frames, transcripts, Work Maps), the workspace owner's organisation is usually the controller and we act as its processor under a data processing agreement (see [dpa-template.md](dpa-template.md)). For account data and usage counters, we are the controller.

## 2. What we process

| Category | What it is | Source in code |
|---|---|---|
| Account data | Email address used to sign in, user id | Supabase Auth, `src/app/api/auth/**`, `src/app/auth/**` |
| Screen frames | Images of the one window the user chooses to share during a session | `src/lib/capture/controller.ts`, `src/app/api/vision/**` |
| Transcripts | Text of what the expert and the voice agent say during a session | `src/app/api/session/**`, `src/app/api/voice/**` |
| Screen events | Structured descriptions of what happened on screen (for example "clicked Save"), derived from frames | `src/lib/perception/vision.ts`, `src/lib/perception/redactEvent.ts` |
| Work Maps | Step-by-step process descriptions generated from a session | `src/lib/workmap/synthesize.ts`, `src/app/api/workmap/**`, `src/app/api/workmaps/**` |
| Teach progress | Steps a learner marked as practiced or mastered | `src/app/api/session/[id]/teach/route.ts`, `src/lib/teach/mastery.ts` |
| Usage counters | Counts such as sessions, minutes and model calls per workspace, for limits and billing | usage routes under `src/app/api/` (`src/app/api/usage.routes.test.ts`) |
| Technical logs | Error messages and request metadata | Vercel function logs; Sentry once enabled |

We only capture the window the user selects, and only while a session is running.

## 3. Purposes

- Provide the service: record a session, turn it into screen events and a Work Map, and let the team review, search, export and teach from it.
- Run the voice agent that asks the expert questions during a session.
- Account management and sign-in.
- Enforce plan limits and keep the service secure and working (usage counters, error tracking).

We do not sell personal data and we do not use workspace content to train our own or third-party models. Model vendors are used under terms that exclude training on API data (see [subprocessors.md](subprocessors.md)).

## 4. Legal bases

Under the Swiss Federal Act on Data Protection (nFADP) we process data in line with its principles. Where the EU GDPR applies:

- Art. 6(1)(b) GDPR, performance of a contract: account data, session recording, transcripts, screen events, Work Maps.
- Art. 6(1)(f) GDPR, legitimate interests: security, error tracking, usage counters, preventing abuse.
- Consent (Art. 6(1)(a) GDPR): Teach practice mode. Practice mode is opt-in and private to the learner. A learner can stop practicing at any time; withdrawing consent does not affect earlier processing.

## 5. Off the record and redaction

- Off the record: a speaker can say the workspace's off-the-record phrase (default "off the record", configurable per agent in `src/lib/agents/settings.ts`). The speech that follows is not kept in the transcript.
- Text redaction: names, email addresses, IBANs, phone numbers and card numbers are replaced with placeholders in transcripts and screen events before they are stored (`src/lib/redact/index.ts`, `src/lib/perception/redactEvent.ts`, `src/app/api/redact/route.ts`). Names/emails and IBAN/phone groups can be turned off per agent; card numbers are always redacted.
- Frames are not redacted yet. Screen frames are stored and sent to the vision model as captured. Do not share a window that shows data you do not want recorded.

Redaction is automatic and pattern based. It can miss things.

## 6. Retention

- Screen frames: deleted after the workspace's retention setting (7, 30, 90 or 365 days; default 30 days). A daily job deletes older frames (`src/app/api/cron/retention/route.ts`, `src/lib/agents/admin.ts`).
- Transcripts, screen events and Work Maps: kept until the workspace deletes them.
- Account data: kept while the account exists, then deleted within [number] days.
- Usage counters: kept for [period] for billing and limits.
- Logs: kept for the vendor's default log period ([period]).

## 7. Recipients

We use the subprocessors listed in [subprocessors.md](subprocessors.md). Each receives only the data it needs for its purpose. Inside a workspace, members can see the sessions and Work Maps the workspace shares with them.

## 8. International transfers

Data is hosted in [US or EU, to be decided]. Several subprocessors are in the United States. Transfers rely on the EU-US Data Privacy Framework and its Swiss extension where the vendor is certified, and otherwise on the EU Standard Contractual Clauses (with the Swiss addendum).

## 9. Your rights

Subject to the applicable law, you can ask for access, correction, deletion, restriction, data portability, and object to processing based on legitimate interests. You can withdraw consent at any time. Workspace content is managed by the workspace owner; we forward such requests to them.

Contact [privacy contact address]. You can also complain to a supervisory authority, in Switzerland the FDPIC, or the authority of your EU country.

## 10. Security

Access is limited per workspace (row-level security in Supabase), connections use TLS, and secrets are kept out of the code. Details: [security measures].

## 11. Changes

We will post changes here and tell workspace owners about material changes in advance.
