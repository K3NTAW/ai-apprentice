"use client";

import { useParams, useSearchParams } from "next/navigation";
import DebriefApp from "@/components/debrief/DebriefApp";
import { parseTrainIntent } from "@/lib/processes/train";

export default function DebriefPage() {
  const { id } = useParams<{ id: string }>();
  const q = useSearchParams();
  return <DebriefApp sessionId={id} intent={parseTrainIntent(q.get("process"), q.get("mode"))} />;
}
