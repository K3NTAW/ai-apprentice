// Shared components, 1:1 with docs/design/canvas/Components.dc.html. Styles are the ui-* classes in src/app/globals.css.
import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode } from "react";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export const BUTTON_VARIANTS = ["primary", "secondary", "ghost", "danger", "icon"] as const;
export type ButtonVariant = (typeof BUTTON_VARIANTS)[number];
export type ButtonSize = "sm" | "md" | "lg";

const BUTTON_CLASS: Record<ButtonVariant, string> = {
  primary: "ui-bp",
  secondary: "ui-bs",
  ghost: "ui-bg",
  danger: "ui-bd",
  icon: "ui-bs ui-bi",
};
const SIZE_CLASS: Record<ButtonSize, string> = { sm: "ui-bsm", md: "", lg: "ui-bl" };

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra?: string): string {
  return cx("ui-btn", BUTTON_CLASS[variant], SIZE_CLASS[size], extra);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...rest} />;
}

export function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label className="ui-lbl" htmlFor={htmlFor}>
      {children}
    </label>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx("ui-inp", className)} {...rest} />;
}

/** Six single-digit boxes with the canvas separator after the third. Controlled by `value` (up to 6 digits). */
export function CodeInput({
  value = "",
  onChange,
  name = "code",
  disabled,
}: {
  value?: string;
  onChange?: (value: string) => void;
  name?: string;
  disabled?: boolean;
}) {
  const digits = Array.from({ length: 6 }, (_, i) => value[i] ?? "");
  const set = (i: number, d: string) => {
    const next = digits.slice();
    next[i] = d.replace(/\D/g, "").slice(-1);
    onChange?.(next.join(""));
  };
  return (
    <div className="flex flex-wrap items-center" style={{ gap: 6 }}>
      {digits.map((d, i) => (
        <span key={i} className="contents">
          {i === 3 && <span style={{ color: "var(--fa)" }}>·</span>}
          <input
            className="ui-code"
            aria-label={`Digit ${i + 1}`}
            name={`${name}-${i + 1}`}
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            maxLength={1}
            value={d}
            disabled={disabled}
            onChange={(e) => set(i, e.target.value)}
            readOnly={!onChange}
          />
        </span>
      ))}
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: { id: string; label: string; count?: number; href?: string }[];
  active: string;
  onSelect?: (id: string) => void;
}) {
  return (
    <div className="ui-tabs" role="tablist">
      {tabs.map((t) => {
        const on = t.id === active;
        const body = (
          <>
            {t.label}
            {t.count !== undefined && <span className="ui-mono text-xs" style={{ color: "var(--fa)" }}> {t.count}</span>}
          </>
        );
        return t.href ? (
          <a key={t.id} role="tab" aria-selected={on} href={t.href} className={cx("ui-tab", on && "ui-on")}>
            {body}
          </a>
        ) : (
          <button key={t.id} role="tab" type="button" aria-selected={on} className={cx("ui-tab", on && "ui-on")} onClick={() => onSelect?.(t.id)}>
            {body}
          </button>
        );
      })}
    </div>
  );
}

export const BADGE_KINDS = {
  confirmed: { cls: "ui-k-ok", label: "Confirmed" },
  pending: { cls: "ui-k-pend", label: "Not yet confirmed" },
  limit: { cls: "ui-k-lim", label: "Limit" },
  exception: { cls: "ui-k-exc", label: "Exception" },
  stop_and_ask: { cls: "ui-k-stop", label: "Stop and ask" },
  judgment: { cls: "ui-k-jc", label: "Judgment call" },
  accent: { cls: "ui-k-ac", label: "Training now" },
  missing: { cls: "ui-k-rd", label: "Missing" },
} as const;
export type BadgeKind = keyof typeof BADGE_KINDS;

export function Badge({ kind, children, className }: { kind: BadgeKind; children?: ReactNode; className?: string }) {
  return <span className={cx("ui-bdg", BADGE_KINDS[kind].cls, className)}>{children ?? BADGE_KINDS[kind].label}</span>;
}

/** Score bar with a threshold tick; the fill turns amber below the threshold (canvas: 75 %). */
export function ScoreBar({ label, value, threshold = 75 }: { label: string; value: number; threshold?: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="flex flex-col" style={{ gap: 7 }}>
      <div className="flex justify-between text-[13px]">
        <span>{label}</span>
        <span className="ui-mono">{v}%</span>
      </div>
      <div className="ui-bar" role="meter" aria-label={label} aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
        <i className={v < threshold ? "ui-lo" : undefined} style={{ width: `${v}%` }} />
        <b style={{ left: `${threshold}%` }} />
      </div>
    </div>
  );
}

export const DOT_STATES = ["step", "judgment", "selected", "mastered", "upcoming"] as const;
export type DotState = (typeof DOT_STATES)[number];

export function TimelineDot({ state, label }: { state: DotState; label?: string }) {
  return (
    <div className="ui-dotc">
      <span style={{ height: 36, display: "flex", alignItems: "center" }}>
        <span className={cx("ui-dot", `ui-dot-${state}`)} data-state={state} />
      </span>
      {label && <span className="text-xs" style={{ color: "var(--mu)" }}>{label}</span>}
    </div>
  );
}

/** Agent bubbles are plain; expert bubbles are the italic serif quote style. */
export function SpeechBubble({ from = "agent", meta, children }: { from?: "agent" | "expert"; meta?: string; children: ReactNode }) {
  return (
    <div className={cx("ui-bub", from === "expert" && "ui-bub-expert ui-qs")}>
      {meta && <span className="block text-xs" style={{ color: "var(--mu)" }}>{meta}</span>}
      {children}
    </div>
  );
}

export function Halo({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" className={cx("ui-halo", className)} style={style} />;
}

export function Toast({ children, action }: { children: ReactNode; action?: { label: string; onClick: () => void } }) {
  return (
    <div
      role="status"
      className="ui-card flex items-center"
      style={{ gap: 12, padding: "12px 16px", boxShadow: "var(--sh)", maxWidth: 420, background: "var(--s2)", borderColor: "var(--ln2)" }}
    >
      <span
        style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--grs)", color: "var(--gr)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
      >
        <svg className="ui-ic" viewBox="0 0 24 24" style={{ width: 14, height: 14 }} aria-hidden="true">
          <path d="m5 12 5 5 9-10" />
        </svg>
      </span>
      <span style={{ flex: 1 }}>{children}</span>
      {action && (
        <Button variant="ghost" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

export function Card({ dashed, className, style, children }: { dashed?: boolean; className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <div className={cx("ui-card", dashed && "ui-card-dashed", className)} style={style}>
      {children}
    </div>
  );
}

export function EmptyState({ visual, title, text, action }: { visual?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="ui-card flex flex-col items-center text-center" style={{ padding: 28, gap: 12, background: "var(--bg)" }}>
      {visual}
      <span className="ui-t3">{title}</span>
      {text && <span className="text-[13px]" style={{ color: "var(--mu)", maxWidth: 340 }}>{text}</span>}
      {action}
    </div>
  );
}

export function Keycap({ children }: { children: ReactNode }) {
  return <span className="ui-kc">{children}</span>;
}

export function Chord({ keys }: { keys: string[] }) {
  return (
    <span style={{ display: "inline-flex", gap: 4 }} aria-label={keys.join(" ")}>
      {keys.map((k, i) => (
        <Keycap key={i}>{k}</Keycap>
      ))}
    </span>
  );
}

/** Capture feed row (Capture.dc.html .ev): time, app with colour chip, text, trailing badge or chord. */
export function FeedRow({ time, app, color, children, trailing, muted }: { time: string; app: string; color: string; children: ReactNode; trailing?: ReactNode; muted?: boolean }) {
  return (
    <div className="ui-ev" style={muted ? { background: "var(--s2)" } : undefined}>
      <span className="ui-mono text-xs" style={{ color: "var(--fa)" }}>{time}</span>
      <span className="ui-app">
        <i style={{ background: color }} />
        {app}
      </span>
      <span style={muted ? { color: "var(--mu)" } : undefined}>{children}</span>
      <span>{trailing}</span>
    </div>
  );
}

/** Expert quote: Instrument Serif italic. */
export function Quote({ children, size = 34, className }: { children: ReactNode; size?: number; className?: string }) {
  return (
    <q className={cx("ui-qs", className)} style={{ fontSize: size, quotes: "none" }}>
      {children}
    </q>
  );
}

/** Segmented filter (canvas .seg): pill group, the active segment raised on --s1. */
export function Segmented({
  label,
  items,
  active,
  onSelect,
}: {
  label: string;
  items: { id: string; label: string; count?: number }[];
  active: string;
  onSelect?: (id: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex self-start"
      style={{ padding: 3, borderRadius: 999, background: "var(--s2)", border: "1px solid var(--ln)" }}
    >
      {items.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            data-filter={t.id}
            onClick={() => onSelect?.(t.id)}
            className="ui-seg-btn cursor-pointer border-0 text-[13px] font-medium"
            style={{
              height: 30,
              padding: "0 14px",
              borderRadius: 999,
              fontFamily: "inherit",
              background: on ? "var(--s1)" : "none",
              color: on ? "var(--tx)" : "var(--mu)",
              boxShadow: on ? "0 0 0 1px var(--ln2)" : undefined,
            }}
          >
            {t.label}
            {t.count !== undefined && ` ${t.count}`}
          </button>
        );
      })}
    </div>
  );
}
