"use client";

// Sandbox ERP screen (docs/BUILD_SPEC.md D3): invoice list + detail form, DOM events, and the save hook.
import { useCallback, useRef, useState, type ReactNode } from "react";
import type { Invoice } from "@/lib/types";
import { COST_CENTERS } from "@/lib/erp/seed";
import {
  guardedAction,
  initialState,
  listInvoices,
  open,
  setField,
  type BeforeSaveHook,
  type EditableField,
  type ErpEvent,
  type ErpMode,
  type ErpResult,
  type ErpState,
  type GuardedAction,
} from "@/lib/erp/store";

export type ErpSandboxProps = {
  mode: ErpMode;
  onEvent?: (e: ErpEvent) => void;
  onActivity?: (kind: "keystroke" | "pointer") => void;
  onBeforeSave?: BeforeSaveHook;
  highlightField?: string | null;
};

const STATUS_STYLE: Record<Invoice["approval_status"], string> = {
  open: "bg-slate-200 text-slate-700",
  saved: "bg-green-100 text-green-800",
  on_hold: "bg-amber-100 text-amber-800",
  second_approval: "bg-blue-100 text-blue-800",
};
const STATUS_LABEL: Record<Invoice["approval_status"], string> = {
  open: "Open",
  saved: "Saved",
  on_hold: "On hold",
  second_approval: "2nd approval",
};

const RING = "ring-2 ring-amber-500 ring-offset-1 rounded-sm";
const eur = (n: number) => n.toLocaleString("de-CH", { style: "currency", currency: "EUR" });

function StatusBadge({ status }: { status: Invoice["approval_status"] }) {
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>;
}

function Field({ name, label, highlight, children }: { name: string; label: string; highlight?: string | null; children: ReactNode }) {
  return (
    <div data-erp-field={name} className={`flex flex-col gap-0.5 p-0.5 ${highlight === name ? RING : ""}`}>
      <span className="text-[11px] uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </div>
  );
}

export default function ErpSandbox({ mode, onEvent, onActivity, onBeforeSave, highlightField }: ErpSandboxProps) {
  const stateRef = useRef<ErpState>(initialState(mode));
  const [state, setState] = useState<ErpState>(stateRef.current);
  const [pending, setPending] = useState<GuardedAction | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [assetText, setAssetText] = useState<string | null>(null);

  const apply = useCallback(
    (r: ErpResult) => {
      stateRef.current = r.state;
      setState(r.state);
      r.events.forEach((e) => onEvent?.(e));
    },
    [onEvent],
  );

  const current = state.openId ? state.drafts[state.openId] : null;
  const committed = state.openId ? state.invoices[state.openId] : null;

  function openRow(id: string) {
    if (pending) return;
    setBanner(null);
    setAssetText(null);
    apply(open(stateRef.current, id));
  }

  function change(field: EditableField, value: string) {
    if (!state.openId) return;
    apply(setField(stateRef.current, state.openId, field, value));
  }

  // The save hook: await onBeforeSave first; a block leaves status untouched and emits nothing.
  async function runAction(action: GuardedAction) {
    const id = stateRef.current.openId;
    if (!id || pending) return;
    if (assetText !== null) {
      change("asset_number", assetText);
      setAssetText(null);
    }
    setBanner(null);
    setPending(action);
    try {
      const out = await guardedAction(() => stateRef.current, action, id, onBeforeSave);
      if (!out.allowed) {
        setBanner(out.message ?? "Blocked: nothing was saved.");
        return;
      }
      if (out.result) apply(out.result);
    } finally {
      setPending(null);
    }
  }

  const hl = (name: string) => (highlightField === name ? RING : "");

  const ro = "border border-slate-200 bg-slate-50 px-1.5 py-1 text-sm text-slate-800";

  const button = (action: GuardedAction, label: string, style: string) => (
    <button
      type="button"
      data-erp-field={action}
      disabled={!!pending}
      onClick={() => void runAction(action)}
      className={`border px-3 py-1 text-sm disabled:opacity-60 ${style} ${hl(action)}`}
    >
      {pending === action ? "Checking..." : label}
    </button>
  );

  return (
    <div
      className="flex min-h-[520px] flex-col border border-slate-300 bg-white text-slate-900"
      onKeyDown={() => onActivity?.("keystroke")}
      onPointerMove={() => onActivity?.("pointer")}
    >
      <div className="bg-slate-600 px-3 py-1.5 text-sm font-semibold text-white">Machina ERP - Accounts Payable</div>
      <div className="flex flex-1 flex-col gap-3 p-3 lg:flex-row">
        <table className="h-fit w-full border-collapse text-sm lg:w-1/2">
          <thead>
            <tr className="bg-slate-100 text-left text-[11px] uppercase text-slate-600">
              <th className="border border-slate-200 px-2 py-1">No.</th>
              <th className="border border-slate-200 px-2 py-1">Supplier</th>
              <th className="border border-slate-200 px-2 py-1">Date</th>
              <th className="border border-slate-200 px-2 py-1 text-right">Amount</th>
              <th className="border border-slate-200 px-2 py-1">Status</th>
            </tr>
          </thead>
          <tbody>
            {listInvoices(state).map((inv) => (
              <tr
                key={inv.id}
                onClick={() => openRow(inv.id)}
                className={`cursor-pointer hover:bg-blue-50 ${state.openId === inv.id ? "bg-blue-100" : ""}`}
              >
                <td className="border border-slate-200 px-2 py-1 font-mono">{inv.id}</td>
                <td className="border border-slate-200 px-2 py-1">{inv.supplier}</td>
                <td className="border border-slate-200 px-2 py-1">{inv.date}</td>
                <td className="border border-slate-200 px-2 py-1 text-right tabular-nums">{eur(inv.amount_eur)}</td>
                <td className="border border-slate-200 px-2 py-1">
                  <StatusBadge status={inv.approval_status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {current && committed ? (
          <div data-erp-invoice={current.id} className="flex flex-1 flex-col gap-2 border border-slate-200 p-2">
            <div className="flex items-center justify-between border-b border-slate-200 pb-1">
              <span className="text-sm font-semibold">Invoice {current.id}</span>
              <StatusBadge status={committed.approval_status} />
            </div>
            {banner && (
              <div role="alert" className="border border-red-300 bg-red-50 px-2 py-1 text-sm text-red-800">
                {banner}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Field highlight={highlightField} name="supplier" label="Supplier">
                <div className={ro}>{current.supplier}</div>
              </Field>
              <Field highlight={highlightField} name="supplier_country" label="Country / entity">
                <div className={ro}>
                  {current.supplier_country} / {current.supplier_entity}
                </div>
              </Field>
              <Field highlight={highlightField} name="date" label="Invoice date">
                <div className={ro}>{current.date}</div>
              </Field>
              <Field highlight={highlightField} name="amount_eur" label="Amount">
                <div className={`${ro} tabular-nums`}>{eur(current.amount_eur)}</div>
              </Field>
              <div className="col-span-2">
                <Field highlight={highlightField} name="description" label="Description">
                  <div className={ro}>{current.description}</div>
                </Field>
              </div>
              <Field highlight={highlightField} name="contact_name" label="Contact">
                <div className={ro}>{current.contact_name}</div>
              </Field>
              <Field highlight={highlightField} name="iban" label="IBAN">
                <div className={`${ro} font-mono`}>{current.iban}</div>
              </Field>
              <Field highlight={highlightField} name="cost_center" label="Cost center">
                <select
                  value={current.cost_center}
                  onChange={(e) => change("cost_center", e.target.value)}
                  className="border border-slate-300 px-1 py-1 text-sm"
                >
                  {COST_CENTERS.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} - {c.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field highlight={highlightField} name="asset_number" label="Asset number">
                <input
                  type="text"
                  value={assetText ?? current.asset_number}
                  onChange={(e) => setAssetText(e.target.value)}
                  onBlur={() => {
                    if (assetText !== null) change("asset_number", assetText);
                    setAssetText(null);
                  }}
                  className="border border-slate-300 px-1.5 py-1 font-mono text-sm"
                />
              </Field>
            </div>
            <div className="mt-1 flex gap-2 border-t border-slate-200 pt-2">
              {button("save", "Save", "border-slate-500 bg-slate-600 text-white hover:bg-slate-700")}
              {button("hold", "Hold", "border-slate-300 bg-white hover:bg-slate-50")}
              {button("second_approval", "Send for 2nd approval", "border-slate-300 bg-white hover:bg-slate-50")}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center border border-dashed border-slate-200 text-sm text-slate-500">
            Select an invoice
          </div>
        )}
      </div>
    </div>
  );
}
