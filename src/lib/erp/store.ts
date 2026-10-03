// Pure sandbox ERP state: reducer-style actions that return the next state plus the DOM events to emit.
// No React here so it can be unit tested in node.
import type { Invoice, ScreenEvent } from "@/lib/types";
import { SEED_INVOICES } from "./seed";

export type ErpMode = "capture" | "teach";
export type ErpEvent = Omit<ScreenEvent, "id" | "t" | "source">;
export type EditableField = "cost_center" | "asset_number";
export type GuardedAction = "save" | "hold" | "second_approval";

export type ErpState = {
  mode: ErpMode;
  /** Committed invoices, keyed by id. */
  invoices: Record<string, Invoice>;
  /** Uncommitted edits per invoice; becomes the invoice on save/hold/second approval. */
  drafts: Record<string, Invoice>;
  /** Ids shown in the list, in display order. */
  listIds: string[];
  openId: string | null;
};

export type ErpResult = { state: ErpState; events: ErpEvent[] };

const LIST_IDS: Record<ErpMode, string[]> = {
  capture: ["4471", "4498", "4502", "4517"],
  teach: ["4630", "4498"],
};

export function initialState(mode: ErpMode): ErpState {
  const invoices: Record<string, Invoice> = {};
  const drafts: Record<string, Invoice> = {};
  for (const inv of SEED_INVOICES) {
    if (inv.teach_only && mode !== "teach") continue;
    invoices[inv.id] = { ...inv };
    drafts[inv.id] = { ...inv };
  }
  return { mode, invoices, drafts, listIds: LIST_IDS[mode].filter((id) => id in invoices), openId: null };
}

export function listInvoices(state: ErpState): Invoice[] {
  return state.listIds.map((id) => state.invoices[id]);
}

const entity = (id: string) => ({ kind: "invoice", id });

export function open(state: ErpState, id: string): ErpResult {
  if (!state.invoices[id]) return { state, events: [] };
  return { state: { ...state, openId: id }, events: [{ type: "record_opened", entity: entity(id) }] };
}

export function setField(state: ErpState, id: string, field: EditableField, value: string): ErpResult {
  const draft = state.drafts[id];
  if (!draft || draft[field] === value) return { state, events: [] };
  return {
    state: { ...state, drafts: { ...state.drafts, [id]: { ...draft, [field]: value } } },
    events: [{ type: "field_changed", entity: entity(id), field, from: draft[field], to: value }],
  };
}

const STATUS: Record<GuardedAction, Invoice["approval_status"]> = {
  save: "saved",
  hold: "on_hold",
  second_approval: "second_approval",
};

function commit(state: ErpState, id: string, action: GuardedAction): ErpResult {
  const before = state.invoices[id];
  const draft = state.drafts[id];
  if (!before || !draft) return { state, events: [] };
  const status = STATUS[action];
  const next = { ...draft, approval_status: status };
  return {
    state: {
      ...state,
      invoices: { ...state.invoices, [id]: next },
      drafts: { ...state.drafts, [id]: { ...next } },
    },
    events: [
      { type: "button_clicked", entity: entity(id), field: action },
      { type: "status_changed", entity: entity(id), field: "approval_status", from: before.approval_status, to: status },
    ],
  };
}

export const save = (state: ErpState, id: string) => commit(state, id, "save");
export const hold = (state: ErpState, id: string) => commit(state, id, "hold");
export const sendSecondApproval = (state: ErpState, id: string) => commit(state, id, "second_approval");

export function applyAction(state: ErpState, action: GuardedAction, id: string): ErpResult {
  return commit(state, id, action);
}

export function reset(state: ErpState): ErpResult {
  return { state: initialState(state.mode), events: [] };
}

export type BeforeSaveHook = (ctx: {
  action: GuardedAction;
  invoice: Invoice;
  draft: Invoice;
}) => Promise<{ allow: boolean; message?: string }>;

export type GuardOutcome = { allowed: true } | { allowed: false; message?: string };

/**
 * The save hook. Awaits onBeforeSave (if given) before Save/Hold/Send.
 * A rejected hook counts as a block, so nothing is committed on error.
 */
export async function checkBeforeSave(
  hook: BeforeSaveHook | undefined,
  action: GuardedAction,
  invoice: Invoice,
  draft: Invoice,
): Promise<GuardOutcome> {
  if (!hook) return { allowed: true };
  try {
    const res = await hook({ action, invoice, draft });
    return res.allow ? { allowed: true } : { allowed: false, message: res.message };
  } catch {
    return { allowed: false, message: "Save check failed; nothing was saved." };
  }
}

/** Runs the guard and, only if allowed, the commit. Returns the outcome plus the result (null when blocked). */
export async function guardedAction(
  getState: () => ErpState,
  action: GuardedAction,
  id: string,
  hook: BeforeSaveHook | undefined,
): Promise<GuardOutcome & { result: ErpResult | null }> {
  const s = getState();
  const invoice = s.invoices[id];
  const draft = s.drafts[id];
  if (!invoice || !draft) return { allowed: false, message: "Unknown invoice.", result: null };
  const outcome = await checkBeforeSave(hook, action, invoice, draft);
  if (!outcome.allowed) return { ...outcome, result: null };
  return { allowed: true, result: applyAction(getState(), action, id) };
}
