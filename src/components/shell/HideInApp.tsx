"use client";

// Renders its children in a browser and hides them inside the desktop app (window.apprentice, one-app D2).
// Detection runs after mount, so server and first client render match.
import { useEffect, useState, type ReactNode } from "react";
import { getBridge } from "@/lib/companion/transport";

export default function HideInApp({ children }: { children: ReactNode }) {
  const [inApp, setInApp] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- window.apprentice only exists on the client.
    setInApp(getBridge() !== null);
  }, []);
  return inApp ? null : <>{children}</>;
}
