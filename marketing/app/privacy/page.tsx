import type { Metadata } from "next";
import SitePage from "@/components/landing/SitePage";
import { appUrl } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy · AI Apprentice" };

// Placeholder until the legal text is written.
export default function PrivacyPage() {
  return (
    <SitePage appUrl={appUrl()} screen="privacy">
      <h1 className="ui-t1">Privacy</h1>
      <p className="text-[15px]" style={{ color: "var(--mu)" }}>
        This is a placeholder. The privacy policy follows before launch. In short: capture stops when you say &quot;off the
        record&quot;, personal data is redacted before storage, and nobody learns from a step until the expert has confirmed it.
      </p>
    </SitePage>
  );
}
