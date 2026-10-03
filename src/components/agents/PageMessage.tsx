// Plain message page used by the agent routes for signed-out, misconfigured and load errors.
export default function PageMessage({ title, text }: { title: string; text: string }) {
  return (
    <main className="flex flex-col gap-2 p-8">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="text-muted">{text}</p>
    </main>
  );
}
