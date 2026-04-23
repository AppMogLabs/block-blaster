"use client";

import { usePathname } from "next/navigation";

export function BackgroundLogo() {
  const pathname = usePathname();
  if (pathname?.startsWith("/game")) return null;
  return <div className="bg-logo" aria-hidden="true" />;
}
