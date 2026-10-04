"use client";
// User menu theme toggle (T-0166). Sets data-theme on <html> and keeps the choice in localStorage; the shell
// re-applies it on mount (no head script in production, see src/app/layout.tsx).
import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
export const THEME_KEY = "aa-theme";

type Doc = { documentElement: { getAttribute(n: string): string | null; setAttribute(n: string, v: string): void } };
type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };
type Media = (q: string) => { matches: boolean };

export function currentTheme(doc: Doc, media?: Media): Theme {
  const t = doc.documentElement.getAttribute("data-theme");
  if (t === "light" || t === "dark") return t;
  return media?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function applyTheme(doc: Doc, store: Store | null, theme: Theme) {
  doc.documentElement.setAttribute("data-theme", theme);
  try {
    store?.setItem(THEME_KEY, theme);
  } catch {
    // Storage blocked: the theme still applies for this page.
  }
}

export function storedTheme(store: Store | null): Theme | null {
  try {
    const t = store?.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    const saved = storedTheme(window.localStorage);
    if (saved) document.documentElement.setAttribute("data-theme", saved);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the theme is only known on the client.
    setTheme(currentTheme(document, (q) => window.matchMedia(q)));
  }, []);
  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(document, window.localStorage, next);
    setTheme(next);
  }
  return (
    <button type="button" role="menuitem" className="ui-mi" onClick={toggle} data-testid="theme-toggle">
      <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />
      </svg>
      {theme === "dark" ? "Light theme" : "Dark theme"}
    </button>
  );
}
