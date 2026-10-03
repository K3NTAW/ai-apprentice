import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Dashboard, { quickActions } from "./Dashboard";

describe("Dashboard quick actions (fix round T-0123)", () => {
  it("inside the desktop app the companion install link is left out", () => {
    const hrefs = quickActions("owner", { inApp: true }).map((a) => a.href);
    expect(hrefs).toEqual(["/capture", "/teach", "/workspace"]);
    expect(hrefs).not.toContain("/capture#companion");
  });

  it("in the browser it shows, marked browser only; learners get no capture action", () => {
    const actions = quickActions("learner");
    expect(actions.map((a) => a.href)).toEqual(["/teach", "/workspace", "/capture#companion"]);
    expect(actions.find((a) => a.href === "/capture#companion")?.browserOnly).toBe(true);
    const html = renderToStaticMarkup(<Dashboard summary={{ experts: [], learners: [] }} role="owner" />);
    expect(html).toContain('href="/capture#companion"');
    expect(html).toContain("Install the desktop companion");
  });
});
