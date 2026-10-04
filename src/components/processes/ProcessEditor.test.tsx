import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { previewProcess, previewProcessVersions } from "@/lib/fixtures/processes";
import { editStep } from "@/lib/processes/edit";
import ProcessEditor from "./ProcessEditor";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

const render = (role: "owner" | "expert" | "learner", process = previewProcess) =>
  renderToStaticMarkup(<ProcessEditor id={process.id} role={role} editor="Ana" initial={{ process, versions: previewProcessVersions }} />);

describe("process page (slice d)", () => {
  it("owner: rename, step and guardrail edits, archive, delete, restore, and both training entry points", () => {
    const html = render("owner");
    for (const label of ["Rename", "Save step", "Move up", "Move down", "Delete step", "Add guardrail", "Archive", "Delete process", "Restore"])
      expect(html).toContain(label);
    expect(html).toContain('href="/capture?agent=pip&amp;process=pip-process&amp;mode=extend"');
    expect(html).toContain('href="/capture?agent=pip&amp;process=pip-process&amp;mode=replace"');
    expect(html).toContain("Add to this process");
    expect(html).toContain("Retrain from scratch");
  });

  it("expert edits but cannot archive or delete", () => {
    const html = render("expert");
    expect(html).toContain("Save step");
    expect(html).toContain("Add to this process");
    expect(html).not.toContain("Delete process");
    expect(html).not.toContain(">Archive<");
  });

  it("learner reads only", () => {
    const html = render("learner");
    for (const label of ["Rename", "Save step", "Delete process", "Add to this process", ">Restore<"]) expect(html).not.toContain(label);
  });

  it("shows 'edited by' on an edited quote", () => {
    const n = previewProcess.workmap.steps[0].n;
    const edited = { ...previewProcess, workmap: editStep(previewProcess.workmap, n, { reason: "Typed again" }, "Sabine Keller") };
    expect(render("owner", edited)).toContain("edited by Sabine Keller");
  });
});
