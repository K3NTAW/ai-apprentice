import Link from "next/link";

export default function Home() {
  return (
    <main className="flex flex-col gap-2 p-8">
      <h1 className="text-lg font-semibold">AI Apprentice</h1>
      <Link className="underline" href="/capture">
        Capture
      </Link>
      <Link className="underline" href="/map">
        Work Maps
      </Link>
      <Link className="underline" href="/teach">
        Teach
      </Link>
    </main>
  );
}
