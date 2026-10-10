"use client";

import { MulticaIcon } from "@multica/ui/components/common/multica-icon";

export function MulticaBrandMark({ className = "flex items-center gap-2 text-foreground" }: { className?: string }) {
  return (
    <div className={className}>
      <MulticaIcon className="size-5" noSpin />
      <span className="text-sm font-semibold lowercase tracking-[0.04em]">multica</span>
    </div>
  );
}
