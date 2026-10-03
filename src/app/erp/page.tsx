import ErpPageClient from "./ErpPageClient";

export default async function ErpPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode } = await searchParams;
  return <ErpPageClient mode={mode === "teach" ? "teach" : "capture"} />;
}
