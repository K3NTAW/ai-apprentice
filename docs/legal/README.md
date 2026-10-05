# Legal drafts

Status: UNPUBLISHED DRAFTS, not reviewed by a lawyer, no entity yet.

Nothing in this folder is legal advice. These are working drafts so that the product can be described accurately once a legal entity exists. Do not link them from the app or the marketing site.

## Files

- [privacy-policy.md](privacy-policy.md): what [product name] processes, why, how long, and who receives it.
- [imprint.md](imprint.md): imprint (legal notice) placeholder block.
- [subprocessors.md](subprocessors.md): external processors the code calls.
- [dpa-template.md](dpa-template.md): data processing agreement template for workspaces.
- [beta-agreement-template.md](beta-agreement-template.md): beta / design partner agreement template.

## Before publishing

All of these must be true:

1. The legal entity is founded; every `[entity to be founded]`, `[address]`, `[register number]` and `[VAT number]` placeholder is filled.
2. Product name and domain are decided; every `[product name]` and `[domain]` placeholder is filled.
3. Hosting region is decided (`[US or EU, to be decided]`), and the transfer section of the privacy policy matches it.
4. A DPA is signed (or accepted online) with each vendor in subprocessors.md, and each `[DPA link]` is filled.
5. The subprocessor list is re-checked against the code at the publishing commit.
6. Default frame retention in the code matches the policy (30 days). Today `DEFAULT_SETTINGS.retention_days` in `src/lib/agents/settings.ts` is 90, so either the code or the policy must change.
7. "Teach practice is private to the learner" is checked against access rules. Today `src/app/api/session/[id]/teach/route.ts` lets the session creator or a workspace owner write teach progress.
8. A lawyer has reviewed the texts for Switzerland (nFADP) and the EU (GDPR).
9. The placeholder pages `marketing/app/privacy/page.tsx` and `marketing/app/imprint/page.tsx` are replaced in a separate task.

Decision: see roadmap decision 5.6 (publishing legal texts waits for the entity).
