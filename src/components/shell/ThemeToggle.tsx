"use client";
// User menu theme choice (T-0166, dark / light / system since T-0190). Sets data-theme on <html> and keeps the choice
// in localStorage; the shell re-applies it on mount (no head script in production, see src/app/layout.tsx).
import { useEffect, useState } from "react";

export type Theme = "light" | "dark";
export type ThemeChoice = Theme | "system";
export const THEME_KEY = "aa-theme";
export const THEME_CHOICES: readonly ThemeChoice[] = ["dark", "light", "system"];

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

/** The stored light or dark theme; null for 'system' or nothing stored. */
export function storedTheme(store: Store | null): Theme | null {
  try {
    const t = store?.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

/** The stored choice; 'system' when nothing (or something unknown) is stored. */
export function storedChoice(store: Store | null): ThemeChoice {
  try {
    const t = store?.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export const resolveTheme = (choice: ThemeChoice, media?: Media): Theme =>
  choice === "system" ? (media?.("(prefers-color-scheme: light)").matches ? "light" : "dark") : choice;

/** Applies the resolved theme and remembers the choice ('system' follows the OS setting). */
export function applyThemeChoice(doc: Doc, store: Store | null, choice: ThemeChoice, media?: Media) {
  doc.documentElement.setAttribute("data-theme", resolveTheme(choice, media));
  try {
    store?.setItem(THEME_KEY, choice);
  } catch {
    // Storage blocked: the theme still applies for this page.
  }
}

const LABELS: Record<ThemeChoice, string> = { dark: "Dark", light: "Light", system: "System" };

export default function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  useEffect(() => {
    const saved = storedChoice(window.localStorage);
    document.documentElement.setAttribute("data-theme", resolveTheme(saved, (q) => window.matchMedia(q)));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the theme is only known on the client.
    setChoice(saved);
  }, []);
  function choose(next: ThemeChoice) {
    applyThemeChoice(document, window.localStorage, next, (q) => window.matchMedia(q));
    setChoice(next);
  }
  return (
    <div role="group" aria-label="Theme" className="flex flex-wrap items-center gap-[10px]" style={{ padding: "6px 10px" }} data-testid="theme-toggle">
      <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />
      </svg>
      <span className="flex-1 text-[13px]">Theme</span>
      <span className="ui-tabs" style={{ display: "inline-flex" }}>
        {THEME_CHOICES.map((c) => (
          <button
            key={c}
            type="button"
            role="menuitemradio"
            aria-checked={choice === c}
            className={choice === c ? "ui-tab ui-on" : "ui-tab"}
            onClick={() => choose(c)}
            data-theme-choice={c}
          >
            {LABELS[c]}
          </button>
        ))}
      </span>
    </div>
  );
}
