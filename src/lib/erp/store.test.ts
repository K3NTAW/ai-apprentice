import { describe, expect, it, vi } from "vitest";
import { KNOWN_PII_NAMES, SEED_INVOICES } from "./seed";
import {
  guardedAction,
  hold,
  initialState,
  listInvoices,
  open,
  reset,
  save,
  sendSecondApproval,
  setField,
  type ErpState,
} from "./store";

const byId = (id: string) => SEED_INVOICES.find((i) => i.id === id);

describe("seed", () => {
  it("has A, B, C, T with the listed data", () => {
    expect(byId("4471")).toMatchObject({ amount_eur: 7400, cost_center: "4711", asset_number: "" });
    expect(byId("4502")).toMatchObject({ amount_eur: 1860, supplier: "Nordlicht Verpackung AG" });
    expect(byId("4498")).toMatchObject({ amount_eur: 1860, supplier: "Nordlicht Verpackung AG", approval_status: "saved" });
    expect(byId("4517")).toMatchObject({ amount_eur: 3250, supplier_country: "CZ", supplier_entity: "subsidiary" });
    expect(byId("4630")).toMatchObject({ amount_eur: 7200, teach_only: true });
    for (const inv of SEED_INVOICES) {
      expect(inv.contact_name).toBeTruthy();
      expect(inv.iban).toBeTruthy();
    }
    expect(KNOWN_PII_NAMES.length).toBeGreaterThan(0);
  });
});

describe("store", () => {
  it("capture mode never lists T; teach mode shows T plus 4498", () => {
    const cap = initialState("capture");
    expect(listInvoices(cap).map((i) => i.id)).toEqual(["4471", "4498", "4502", "4517"]);
    expect(open(cap, "4630").events).toEqual([]);
    expect(listInvoices(initialState("teach")).map((i) => i.id)).toEqual(["4630", "4498"]);
  });

  it("open emits record_opened", () => {
    const r = open(initialState("capture"), "4471");
    expect(r.state.openId).toBe("4471");
    expect(r.events).toEqual([{ type: "record_opened", entity: { kind: "invoice", id: "4471" } }]);
  });

  it("setField cost_center 4711 -> 0400 emits field_changed with from/to", () => {
    const r = setField(initialState("capture"), "4471", "cost_center", "0400");
    expect(r.events).toEqual([
      { type: "field_changed", entity: { kind: "invoice", id: "4471" }, field: "cost_center", from: "4711", to: "0400" },
    ]);
    expect(r.state.drafts["4471"].cost_center).toBe("0400");
    expect(r.state.invoices["4471"].cost_center).toBe("4711");
    expect(setField(r.state, "4471", "cost_center", "0400").events).toEqual([]);
  });

  it("save emits button_clicked then status_changed and commits the draft", () => {
    const s1 = setField(initialState("capture"), "4471", "cost_center", "0400").state;
    const r = save(s1, "4471");
    expect(r.events.map((e) => e.type)).toEqual(["button_clicked", "status_changed"]);
    expect(r.events[0].field).toBe("save");
    expect(r.events[1]).toMatchObject({ from: "open", to: "saved" });
    expect(r.state.invoices["4471"]).toMatchObject({ cost_center: "0400", approval_status: "saved" });
  });

  it("hold and sendSecondApproval set the right status", () => {
    const h = hold(initialState("capture"), "4502");
    expect(h.events.map((e) => [e.type, e.field])).toEqual([["button_clicked", "hold"], ["status_changed", "approval_status"]]);
    expect(h.state.invoices["4502"].approval_status).toBe("on_hold");
    const a = sendSecondApproval(initialState("capture"), "4517");
    expect(a.events.map((e) => [e.type, e.field])).toEqual([["button_clicked", "second_approval"], ["status_changed", "approval_status"]]);
    expect(a.state.invoices["4517"].approval_status).toBe("second_approval");
  });

  it("reset restores the seed", () => {
    const start = initialState("capture");
    let s = setField(start, "4471", "cost_center", "0400").state;
    s = save(open(s, "4471").state, "4471").state;
    expect(reset(s).state).toEqual(start);
  });
});

describe("save hook guard", () => {
  const holder = (s: ErpState) => {
    let cur = s;
    return { get: () => cur };
  };

  it("blocks on allow:false: no status change, no events, message passed through", async () => {
    const st = holder(setField(initialState("capture"), "4471", "cost_center", "0400").state);
    const hook = vi.fn().mockResolvedValue({ allow: false, message: "Ask first" });
    const out = await guardedAction(st.get, "save", "4471", hook);
    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({ action: "save", invoice: expect.objectContaining({ cost_center: "4711" }), draft: expect.objectContaining({ cost_center: "0400" }) }),
    );
    expect(out).toEqual({ allowed: false, message: "Ask first", result: null });
  });

  it("treats a rejected hook as a block", async () => {
    const st = holder(initialState("capture"));
    const out = await guardedAction(st.get, "hold", "4502", () => Promise.reject(new Error("x")));
    expect(out.allowed).toBe(false);
    expect(out.result).toBeNull();
  });

  it("commits when allowed or when no hook is given", async () => {
    const st = holder(initialState("capture"));
    const a = await guardedAction(st.get, "second_approval", "4517", async () => ({ allow: true }));
    expect(a.result?.state.invoices["4517"].approval_status).toBe("second_approval");
    const b = await guardedAction(st.get, "save", "4471", undefined);
    expect(b.result?.events.map((e) => e.type)).toEqual(["button_clicked", "status_changed"]);
  });
});
