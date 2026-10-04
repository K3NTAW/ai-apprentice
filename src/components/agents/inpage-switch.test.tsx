// In-page switches (agent tabs, Work Map steps, Learn agent picks, studio pickers) change local state and at most
// replace the URL through native history: no router call, so no route navigation and no loading boundary.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ setState: vi.fn(), dispatch: vi.fn(), push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));

// No DOM in this suite: components are called as functions with hooks reduced to their initial values and spies.
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: (init: unknown) => [typeof init === "function" ? (init as () => unknown)() : init, h.setState],
    useReducer: (_r: unknown, arg: unknown, init?: (a: unknown) => unknown) => [init ? init(arg) : arg, h.dispatch],
    useMemo: (f: () => unknown) => f(),
    useEffect: () => {},
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, replace: h.replace, refresh: h.refresh, prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

import AgentTabs from "./AgentTabs";
import LearnView from "./LearnView";
import { AGENT_A, SESSIONS } from "./fixtures";
import { learnAgents, learnProcesses } from "./model";
import { Tabs } from "@/components/ui";
import AvatarStudio from "@/components/avatar/AvatarStudio";
import WorkMapViewer from "@/components/map/WorkMapViewer";
import { pipWorkMap } from "@/lib/fixtures/preview";

type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function findAll(node: ReactNode, pred: (el: El) => boolean, out: El[] = []): El[] {
  if (Array.isArray(node)) node.forEach((n) => findAll(n, pred, out));
  else if (isValidElement(node)) {
    const el = node as El;
    if (pred(el)) out.push(el);
    findAll(el.props.children, pred, out);
  }
  return out;
}
const plain = () => ({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, preventDefault: vi.fn() });
const replaceState = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", { history: { replaceState, state: null } });
});
afterEach(() => vi.unstubAllGlobals());

const noNavigation = () => {
  expect(h.push).not.toHaveBeenCalled();
  expect(h.replace).not.toHaveBeenCalled();
  expect(h.refresh).not.toHaveBeenCalled();
};

describe("in-page switches stay on the page", () => {
  it("agent tabs swap the panel and only replace ?tab= in the address bar", () => {
    const panels = { processes: "P", shortcuts: "S", guardrails: "G", learners: "L", settings: "X" };
    const counts = { processes: 1, shortcuts: 0, guardrails: 0, learners: 0, settings: undefined };
    const tree = AgentTabs({ agentId: "agent-a", initial: "processes", counts, panels });
    expect(findAll(tree, (el) => el.type === "section")[0].props.children).toBe("P");
    const [tabs] = findAll(tree, (el) => el.type === Tabs);
    const links = findAll(Tabs(tabs.props as Parameters<typeof Tabs>[0]), (el) => el.type === "a");
    expect(links.map((a) => a.props["data-shallow"])).toEqual(["", "", "", "", ""]);
    const shortcuts = links.find((a) => a.props.href === "/agents/agent-a?tab=shortcuts")!;
    const e = plain();
    (shortcuts.props.onClick as (e: unknown) => void)(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(h.setState).toHaveBeenCalledWith("shortcuts");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/agents/agent-a?tab=shortcuts");
    noNavigation();
  });

  it("a modified click on a tab keeps the browser default (open in a new tab)", () => {
    const tabs = Tabs({ tabs: [{ id: "a", label: "A", href: "/x?tab=a" }], active: "a", onSelect: h.setState });
    const [a] = findAll(tabs, (el) => el.type === "a");
    const e = { ...plain(), metaKey: true };
    (a.props.onClick as (e: unknown) => void)(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(h.setState).not.toHaveBeenCalled();
  });

  it("Work Map step selection is local state", () => {
    expect(pipWorkMap.steps.length).toBeGreaterThan(1);
    const tree = WorkMapViewer({ sessionId: "s1", workmap: pipWorkMap });
    const dots = findAll(tree, (el) => typeof el.props.onPick === "function");
    expect(dots.length).toBe(pipWorkMap.steps.length);
    (dots[1].props.onPick as () => void)();
    expect(h.setState).toHaveBeenCalledWith(1);
    expect(replaceState).not.toHaveBeenCalled();
    noNavigation();
  });

  it("Learn agent picks switch client-side with the processes already loaded", () => {
    const agents = learnAgents([AGENT_A], SESSIONS);
    const processesByAgent = { [AGENT_A.id]: learnProcesses(AGENT_A.id, SESSIONS) };
    const tree = LearnView({ agents, selected: null, processes: [], unknownAgent: false, processesByAgent });
    const [pick] = findAll(tree, (el) => el.props.href === "/learn?agent=agent-a");
    const anchor = (pick.type as (p: unknown) => El)(pick.props);
    expect(anchor.type).toBe("a");
    expect(anchor.props["data-shallow"]).toBe("");
    const e = plain();
    (anchor.props.onClick as (e: unknown) => void)(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(h.setState).toHaveBeenCalledWith("agent-a");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/learn?agent=agent-a");
    noNavigation();
  });

  it("studio pickers dispatch locally", () => {
    const tree = AvatarStudio({ agentId: "agent-a", page: { backHref: "/agents/agent-a", backLabel: "Agent" } });
    const chips = findAll(tree, (el) => el.type === "button" && el.props["aria-pressed"] !== undefined);
    expect(chips.length).toBeGreaterThan(2);
    for (const c of chips) (c.props.onClick as () => void)();
    expect(h.dispatch).toHaveBeenCalledTimes(chips.length);
    expect(replaceState).not.toHaveBeenCalled();
    noNavigation();
  });
});
