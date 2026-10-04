"use client";

// Popover menu behaviour for the sidebar workspace and user menus: a button toggles it, Esc closes and returns
// focus to the button, ArrowUp/ArrowDown move between menu items, a pointer press outside closes it.
// The menu renders in the top Layer (a portal on body, position fixed), anchored to the button by menuPosition:
// 'above' opens upward from the button's left edge (workspace menu), 'side' opens to the right of the sidebar,
// bottoms aligned, and below the button at phone width (user menu). Kept inside the viewport.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { LAYER_Z } from "@/components/ui/Layer";

const ITEMS = '[role="menuitem"],[role="menuitemradio"]';

export type MenuPlace = "above" | "side";
type Rect = { top: number; bottom: number; left: number; right: number };

const GAP = 8;
const EDGE = 12;
const MD = 768;

/** Fixed-position style for a menu of the given width next to the anchor rect, inside a vw x vh viewport. */
export function menuPosition(place: MenuPlace, anchor: Rect, width: number, vw: number, vh: number): CSSProperties {
  const w = Math.min(width, vw - 2 * EDGE);
  const clampLeft = (left: number) => Math.max(EDGE, Math.min(left, vw - w - EDGE));
  const base: CSSProperties = { position: "fixed", zIndex: LAYER_Z, width: w, overflowY: "auto" };
  if (place === "side" && vw >= MD) {
    const bottom = Math.max(EDGE, vh - anchor.bottom);
    return { ...base, left: clampLeft(anchor.right + 14), bottom, maxHeight: vh - bottom - EDGE };
  }
  if (place === "side") return { ...base, left: clampLeft(anchor.right - w), top: anchor.bottom + GAP, maxHeight: vh - anchor.bottom - GAP - EDGE };
  const bottom = vh - anchor.top + GAP;
  return { ...base, left: clampLeft(anchor.left), bottom, maxHeight: Math.max(120, anchor.top - GAP - EDGE) };
}

export function useMenu(place: MenuPlace = "above", width = 300) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({ position: "fixed", zIndex: LAYER_Z, width });
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place_ = () => {
      const r = buttonRef.current?.getBoundingClientRect();
      if (r) setPosition(menuPosition(place, r, width, window.innerWidth, window.innerHeight));
    };
    place_();
    window.addEventListener("resize", place_);
    window.addEventListener("scroll", place_, true);
    return () => {
      window.removeEventListener("resize", place_);
      window.removeEventListener("scroll", place_, true);
    };
  }, [open, place, width]);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>(ITEMS)?.focus();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      // The menu is portalled out of rootRef, so a press inside it is not outside.
      if (rootRef.current && !rootRef.current.contains(t) && !menuRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]!.focus();
  };

  return { open, setOpen, close, rootRef, buttonRef, menuRef, onMenuKeyDown, menuStyle: position };
}
