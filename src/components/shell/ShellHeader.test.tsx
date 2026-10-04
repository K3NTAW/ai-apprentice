import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ShellHeader, { type ShellUser } from "./ShellHeader";

const render = (user: ShellUser | null) => renderToStaticMarkup(<ShellHeader user={user} />);
const base: ShellUser = { mode: "supabase", workspaceName: "Acme AP", email: "lena@example.com", role: "owner" };

describe("ShellHeader", () => {
  it("shows the nav links, Agents first, for every role and when the context is missing", () => {
    for (const user of [base, { ...base, role: "learner" as const }, { ...base, mode: "local" as const }, null]) {
      const html = render(user);
      for (const [href, label] of [
        ["/agents", "Agents"],
        ["/learn", "Learn"],
        ["/workspace", "Workspace"],
        ["/download", "Get the desktop app"],
      ]) {
        expect(html).toContain(`href="${href}"`);
        expect(html).toContain(`>${label}</span></a>`);
      }
      expect(html.indexOf('href="/agents"')).toBeLessThan(html.indexOf('href="/learn"'));
    }
  });

  it("hides 'Start capture' for a learner, shows it for owners and experts", () => {
    expect(render({ ...base, role: "learner" })).not.toContain("Start capture");
    expect(render(base)).toContain("Start capture");
    expect(render({ ...base, role: "expert" })).toContain("Start capture");
  });

  it("supabase mode: workspace, address and sign-out; local mode: the badge instead", () => {
    const html = render(base);
    expect(html).toContain("Acme AP");
    expect(html).toContain("lena@example.com");
    expect(html).toContain('action="/auth/signout"');
    expect(html).not.toContain("local mode");
    const local = render({ mode: "local", workspaceName: "local", email: null, role: "owner" });
    expect(local).toContain("local mode");
    expect(local).not.toContain("Sign out");
  });

  it("the logo links to the dashboard (/agents), never '/' (T-0255)", () => {
    for (const user of [base, { ...base, mode: "local" as const }, null]) {
      const html = render(user);
      const logo = html.match(/<a [^>]*aria-label="AI Apprentice home"[^>]*>/)?.[0] ?? "";
      expect(logo).toContain('href="/agents"');
      expect(html).not.toContain('href="/"');
    }
  });
});
