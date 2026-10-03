import TeachApp from "@/components/teach/TeachApp";

export default async function TeachPage({ searchParams }: { searchParams: Promise<{ session?: string | string[] }> }) {
  const { session } = await searchParams;
  return <TeachApp sessionId={typeof session === "string" ? session : null} />;
}
