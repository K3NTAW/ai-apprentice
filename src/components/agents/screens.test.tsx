// Key canvas elements of the new agent steps (NewAgent, NewAgent2, NewAgent3), the studio and the workspace.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AvatarStudio from "@/components/avatar/AvatarStudio";
import NewAgentFlow from "./NewAgentFlow";

describe("new agent flow (NewAgent.dc.html, NewAgent2.dc.html, NewAgent3.dc.html)", () => {
  it("step 1: stepper, details form and card preview", () => {
    const html = renderToStaticMarkup(<NewAgentFlow />);
    for (const t of ["Details", "Avatar", "Install and train", "Who is it, and who does it learn from?", "You can change all of this later.", "Agent name", "Role it will fill", "Expert it learns from", "Only the expert can train this agent.", "Cancel", "Continue", "Card preview", "Not trained yet", "Next you give it a face. The default is a grey round shape."]) {
      expect(html).toContain(t);
    }
    expect(html).toContain('aria-current="step"');
  });

  it("steps 2 and 3: the face, 'Running in AI Apprentice' (no pairing) and Start training to Capture", () => {
    const html = renderToStaticMarkup(<NewAgentFlow initialAgentId="a1" />);
    expect(html).toContain("a face");
    expect(html).toContain("Learners see this avatar next to their cursor, so pick something friendly and easy to spot.");
    expect(html).toContain("Running in AI Apprentice");
    expect(html).not.toMatch(/pair it|6-digit|share screen/i);
    expect(html).toMatch(/href="\/capture\?agent=a1"[^>]*>Start training</);
  });
});

describe("avatar studio (Studio.dc.html)", () => {
  it("shape, face, body colour, accent and the actions", () => {
    const html = renderToStaticMarkup(<AvatarStudio />);
    for (const t of ["Shape", "Face", "Body colour", "Accent", "Randomize", "Export SVG", "Export PNG"]) expect(html).toContain(t);
    expect(html).toContain('data-screen="avatar-studio"');
  });
});
