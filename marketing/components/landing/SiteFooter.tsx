import Link from "next/link";

const faint = { color: "var(--fa)" } as const;

export default function SiteFooter() {
  return (
    <footer className="border-t border-[var(--ln)]">
      <div className="mx-auto flex max-w-[1240px] flex-wrap justify-between gap-4 px-5 py-6 text-sm sm:px-8" style={faint}>
        <span>AI Apprentice · hackathon build, October 2026</span>
        <nav className="flex flex-wrap gap-4" aria-label="Footer">
          <Link href="/download" style={faint}>Download</Link>
          <Link href="/privacy" style={faint}>Privacy</Link>
          <Link href="/imprint" style={faint}>Imprint</Link>
        </nav>
        <span>Built in Zug, Switzerland</span>
      </div>
    </footer>
  );
}
