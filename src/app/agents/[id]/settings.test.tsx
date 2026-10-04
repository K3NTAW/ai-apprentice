// Settings tab (src/components/agents/AgentSettings.tsx) against docs/design/canvas/Agent.dc.html, settings tab:
// card titles, labels, hints, options and the delete text are quoted from the canvas.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));

import AgentSettings, { canConfirmDelete, deleteText, patchIdentity } from "@/components/agents/AgentSettings";
import { AGENT_A } from "@/components/agents/fixtures";

const html = (role: "owner" | "expert" | "learner", workMaps = 6) =>
  renderToStaticMarkup(<AgentSettings agent={{ ...AGENT_A, name: "Pip" }} role={role} workMaps={workMaps} />);

afterEach(() => vi.unstubAllGlobals());

describe("agent settings tab", () => {
  it("renders the four canvas cards with their labels, hints and options", () => {
    const out = html("owner");
    for (const title of ["Identity", "Questions while training", "Privacy", "Delete Pip"]) expect(out).toContain(`>${title}</h2>`);
    for (const label of ["Name", "Role", "Expert"]) expect(out).toContain(`>${label}</label>`);
    expect(out).toContain("Edit avatar");
    expect(out).toContain("At most one question every");
    expect(out).toContain("Pauses shorter than 4 s never trigger a question");
    for (const o of ["1 min", "2 min", "3 min", "5 min"]) expect(out).toContain(`>${o}</option>`);
    for (const label of ["Ask about guardrails first", "Learn keyboard shortcuts", "Redact names and email addresses", "Redact IBANs and phone numbers"])
      expect(out).toContain(`aria-label="${label}"`);
    for (const o of ["Calm", "Neutral", "Energetic", "0.8×", "1.0×", "1.2×"]) expect(out).toContain(`>${o}</option>`);
    expect(out).toContain("Off the record phrase");
    expect(out).toContain("Also works with the button or ⌥⇧O");
    expect(out).toContain('value="off the record"');
    expect(out).toContain("Keep screen moments for");
    for (const o of ["7 days", "30 days", "90 days", "365 days"]) expect(out).toContain(`>${o}</option>`);
    expect(out).toContain(deleteText("Pip", 6).replace("'", "&#x27;"));
    expect(deleteText("Pip", 6)).toBe(
      "Removes Pip, its 6 Work Maps, every training and teach session with its screen moments, and all learner progress. Only the owner or the agent's creator can delete it.",
    );
  });

  it("owner sees Delete behind a typed confirmation; others see Request deletion", () => {
    const owner = html("owner");
    expect(owner).toContain(">Delete</button>");
    expect(owner).not.toContain("Request deletion");
    expect(canConfirmDelete("Pi", "Pip")).toBe(false);
    expect(canConfirmDelete(" Pip ", "Pip")).toBe(true);
    for (const role of ["expert", "learner"] as const) {
      const out = html(role);
      expect(out).toContain(">Request deletion</button>");
      expect(out).not.toContain(">Delete</button>");
    }
  });

  it("privacy is owner only; learners cannot edit identity", () => {
    expect(html("expert")).toMatch(/aria-label="Redact names and email addresses" disabled=""/);
    expect(html("owner")).not.toMatch(/aria-label="Redact names and email addresses" disabled=""/);
    expect(html("learner")).toMatch(/id="set-name"[^>]*disabled=""/);
  });

  it("identity edits save with PATCH /api/agents/[id] and report inline", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    expect(await patchIdentity("/api/agents/a1", { name: "Pip", role: "AP Clerk", expert: "" })).toEqual({ ok: true, text: "Saved." });
    expect(fetch).toHaveBeenCalledWith("/api/agents/a1", expect.objectContaining({ method: "PATCH" }));
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toEqual({ name: "Pip", role: "AP Clerk", expert_name: null });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "forbidden" }, { status: 403 })));
    expect(await patchIdentity("/api/agents/a1", { name: "Pip", role: "x", expert: "y" })).toEqual({ ok: false, text: "Could not save (forbidden)." });
  });
});
