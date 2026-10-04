// Loading skeletons for the route segments' loading.tsx (canvas tokens, no hooks: server and client safe).
// shell: the page renders AppShell itself, so the skeleton draws the sidebar too; segments whose layout already
// renders AppShell (capture, teach, debrief, map) pass shell={false}.
// Delayed: the placeholders stay transparent for 400 ms and fade in over 150 ms (.aa-skel-delay in globals.css), so a
// navigation that finishes quickly shows only the empty frame. Reduced motion: shown at once, without the fade.
// The placeholder is a <div role="status">, never a <main>: while the page streams in, React keeps the resolved page
// (with its own <main>) hidden next to the fallback until the reveal, so a skeleton <main> made two of them (T-0257).

export type SkeletonVariant = "list" | "grid" | "detail" | "console" | "form";

export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-panel-2 ${className}`} style={style} />;
}

export const SKELETON_DELAY_CLASS = "aa-skel-delay motion-reduce:animate-none motion-reduce:opacity-100";

/** The one wrapper every loading.tsx goes through (via PageSkeleton): invisible for 400 ms, then fades in. */
export function DelayedSkeleton({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div data-skeleton-delay className={`${SKELETON_DELAY_CLASS} ${className}`}>
      {children}
    </div>
  );
}

function Body({ variant }: { variant: SkeletonVariant }) {
  if (variant === "grid")
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
    );
  if (variant === "console")
    return (
      <div className="flex flex-col gap-4 lg:flex-row">
        <Skeleton className="h-80 flex-1" />
        <Skeleton className="h-80 lg:w-80" />
      </div>
    );
  if (variant === "form")
    return (
      <div className="flex max-w-xl flex-col gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
        <Skeleton className="h-9 w-32" />
      </div>
    );
  if (variant === "detail")
    return (
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-8 w-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-12" />
      ))}
    </div>
  );
}

export function PageSkeleton({ label, variant = "list", shell = true }: { label: string; variant?: SkeletonVariant; shell?: boolean }) {
  const content = (
    <div role="status" aria-busy="true" aria-live="polite" className="flex min-w-0 flex-1 flex-col gap-6" style={{ padding: "28px 40px 56px" }}>
      <span className="sr-only">Loading {label}…</span>
      <DelayedSkeleton className="flex flex-col gap-6">
        <Skeleton className="h-7 w-56" />
        <Body variant={variant} />
      </DelayedSkeleton>
    </div>
  );
  if (!shell) return content;
  return (
    <div data-skeleton-shell className="flex min-h-screen flex-col md:flex-row" style={{ background: "var(--bg)", color: "var(--tx)" }}>
      <div aria-hidden="true" className="flex gap-3 border-line px-3 py-3 md:h-screen md:w-[248px] md:shrink-0 md:flex-col md:border-r md:py-4">
        <DelayedSkeleton className="flex gap-3 md:flex-col">
          <Skeleton className="h-8 w-32" />
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="hidden h-7 md:block" />
          ))}
        </DelayedSkeleton>
      </div>
      {content}
    </div>
  );
}
