"use client";

// HideInApp renders its children in a browser and hides them inside the desktop app (window.apprentice, one-app D2);
// ShowInApp is the inverse. Detection runs after mount, so server and first client render match (browser view).
import { useEffect, useState, type ReactNode } from "react";
import { getBridge } from "@/lib/companion/transport";

function useInApp(): boolean {
  const [inApp, setInApp] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- window.apprentice only exists on the client.
    setInApp(getBridge() !== null);
  }, []);
  return inApp;
}

export default function HideInApp({ children }: { children: ReactNode }) {
  return useInApp() ? null : <>{children}</>;
}

export function ShowInApp({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  return useInApp() ? <>{children}</> : <>{fallback}</>;
}
