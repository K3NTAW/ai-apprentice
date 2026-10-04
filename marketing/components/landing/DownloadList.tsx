import { Badge, buttonClass } from "@/components/ui";
import type { Download } from "@/lib/site";

/** One card per build. A build without a link reads 'Private beta' and has no button. */
export default function DownloadList({ items }: { items: Download[] }) {
  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr))]">
      {items.map((d) => (
        <div key={d.id} className="ui-card flex flex-col gap-4 p-7" data-download={d.id}>
          <div className="flex flex-col gap-1">
            <span className="ui-eb">{d.os}</span>
            <h2 className="ui-t2">{d.label}</h2>
            <p className="text-[15px]" style={{ color: "var(--mu)" }}>{d.detail}</p>
          </div>
          <div className="mt-auto">
            {d.href ? (
              <a className={buttonClass("primary", "lg")} href={d.href}>
                Download for {d.os === "macOS" ? `macOS (${d.label})` : d.os}
              </a>
            ) : (
              <Badge kind="pending">Private beta</Badge>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
