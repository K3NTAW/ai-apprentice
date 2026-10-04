import type { Metadata } from "next";
import SitePage from "@/components/landing/SitePage";
import { appUrl } from "@/lib/site";

export const metadata: Metadata = { title: "Imprint · AI Apprentice" };

// Placeholder until the legal entity details are final.
export default function ImprintPage() {
  return (
    <SitePage appUrl={appUrl()} screen="imprint">
      <h1 className="ui-t1">Imprint</h1>
      <p className="text-[15px]" style={{ color: "var(--mu)" }}>
        This is a placeholder. Company name, address and contact details follow before launch. AI Apprentice is built in
        Zug, Switzerland.
      </p>
    </SitePage>
  );
}
