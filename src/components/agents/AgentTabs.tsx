"use client";

// Agent tabs switch client-side: every panel is rendered with the page, a click swaps the panel and replaces ?tab=
// in the address bar (no route navigation, no loading boundary).
import { useState, type ReactNode } from "react";
import { Tabs } from "@/components/ui";
import { shallowReplace } from "@/lib/nav/shallow";
import { AGENT_TABS, agentHref, TAB_LABELS, type AgentTab } from "./model";

export default function AgentTabs({
  agentId,
  initial,
  counts,
  panels,
}: {
  agentId: string;
  initial: AgentTab;
  counts: Record<AgentTab, number | undefined>;
  panels: Record<AgentTab, ReactNode>;
}) {
  const [tab, setTab] = useState<AgentTab>(initial);
  const select = (id: string) => {
    const t = id as AgentTab;
    setTab(t);
    shallowReplace(agentHref(agentId, t));
  };
  return (
    <>
      <nav aria-label="Agent tabs">
        <Tabs tabs={AGENT_TABS.map((t) => ({ id: t, label: TAB_LABELS[t], count: counts[t], href: agentHref(agentId, t) }))} active={tab} onSelect={select} />
      </nav>
      <section>{panels[tab]}</section>
    </>
  );
}
