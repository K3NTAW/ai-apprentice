// @vitest-environment jsdom
// The login header's marketing link, mounted (T-0224): never in the desktop app (window.apprentice), not even
// for one frame; in the browser only after mount; never in the server render.
import { act, type ReactNode } from "react";
import { hydrateRoot, createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginShell from "./LoginShell";
import { LoginMarketingLink } from "@/components/landing/Landing";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const URL_ = "https://aiapprentice.example/";
const LINK = "What is AI Apprentice?";
const bridge = { on: () => () => {}, send: () => {}, window: () => {} };
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;
let seen: string[];
let observer: MutationObserver;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_MARKETING_URL", URL_);
  host = document.createElement("div");
  document.body.appendChild(host);
  seen = [];
  // Every node React ever inserted, even if removed again before the observer runs (a one-frame flash).
  observer = new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) seen.push(n.textContent ?? "");
  });
  observer.observe(host, { childList: true, subtree: true, characterData: true, attributes: true });
});

afterEach(() => {
  observer.disconnect();
  act(() => root?.unmount());
  root = null;
  host.remove();
  delete (window as { apprentice?: unknown }).apprentice;
  vi.unstubAllEnvs();
});

const shell = () => <LoginShell><p>form</p></LoginShell>;

/** Server-render into the host, then hydrate like the real page load. */
async function hydrate(el: React.ReactElement) {
  host.innerHTML = renderToString(el);
  await act(async () => {});
  seen = [host.innerHTML];
  await act(async () => {
    root = hydrateRoot(host, el);
  });
  observer.takeRecords().forEach((r) => r.addedNodes.forEach((n) => seen.push(n.textContent ?? "")));
}

async function mount(el: React.ReactElement) {
  await act(async () => {
    root = createRoot(host);
    root.render(el);
  });
  observer.takeRecords().forEach((r) => r.addedNodes.forEach((n) => seen.push(n.textContent ?? "")));
}

describe("login marketing link, mounted", () => {
  it("the server render contains no link", () => {
    expect(renderToString(shell())).not.toContain(LINK);
    expect(renderToString(<LoginMarketingLink href={URL_} />)).toBe("");
  });

  it("desktop app (window.apprentice): the link never appears, on hydration or a client mount", async () => {
    (window as { apprentice?: unknown }).apprentice = bridge;
    await hydrate(shell());
    expect(host.textContent).toContain("form");
    expect(host.innerHTML).not.toContain(LINK);
    for (const html of seen) expect(html).not.toContain(LINK);

    act(() => root?.unmount());
    host.innerHTML = "";
    seen = [];
    await mount(shell());
    expect(host.textContent).toContain("form");
    expect(host.innerHTML).not.toContain(LINK);
    for (const html of seen) expect(html).not.toContain(LINK);
  });

  it("browser: hidden in the first render, shown after mount", async () => {
    await hydrate(shell());
    expect(seen[0]).not.toContain(LINK);
    const link = host.querySelector(`a[href="${URL_}"]`);
    expect(link?.textContent).toBe(LINK);
  });

  it("browser: LoginMarketingLink mounted on its own shows the link", async () => {
    await mount(<LoginMarketingLink href={URL_} />);
    expect(host.querySelector("a")?.getAttribute("href")).toBe(URL_);
  });
});
