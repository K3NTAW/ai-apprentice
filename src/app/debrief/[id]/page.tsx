"use client";

import { useParams } from "next/navigation";
import DebriefApp from "@/components/debrief/DebriefApp";

export default function DebriefPage() {
  const { id } = useParams<{ id: string }>();
  return <DebriefApp sessionId={id} />;
}
