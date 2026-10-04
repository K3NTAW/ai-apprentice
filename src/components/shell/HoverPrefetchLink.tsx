"use client";
// Link for long lists (recent sessions, workflow rows): no viewport prefetch, which would fire one request per row;
// it prefetches on hover or focus instead, so a click still finds the route warm.
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ComponentProps } from "react";

export default function HoverPrefetchLink({ href, onMouseEnter, onFocus, ...rest }: ComponentProps<typeof Link> & { href: string }) {
  const router = useRouter();
  return (
    <Link
      {...rest}
      href={href}
      prefetch={false}
      onMouseEnter={(e) => {
        router.prefetch(href);
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        router.prefetch(href);
        onFocus?.(e);
      }}
    />
  );
}
