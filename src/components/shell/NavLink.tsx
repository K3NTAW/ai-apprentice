"use client";

// Sidebar nav item (Sidebar.dc.html .nav); highlighted when the current path is inside its section.
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export default function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const base = href.split("#")[0];
  const on = !href.includes("#") && !!pathname && (pathname === base || pathname.startsWith(`${base}/`));
  return (
    <Link href={href} className={on ? "ui-nav ui-on shrink-0" : "ui-nav shrink-0"} aria-current={on ? "page" : undefined}>
      {children}
    </Link>
  );
}
