// Teach placeholder (pivot wave): the sandbox ERP is gone; the Teach task rebuilds this on real apps,
// with the tutor stopping a risky step by voice and the companion halo.

export type TeachAppProps = { sessionId: string | null; localMode: boolean };

export default function TeachApp(props: TeachAppProps) {
  return (
    <main className="flex flex-col gap-2 p-8" data-session={props.sessionId ?? undefined}>
      <h1 className="text-lg font-semibold">Teach</h1>
      <p className="text-sm text-slate-600">Teach is being rebuilt for real apps</p>
    </main>
  );
}
