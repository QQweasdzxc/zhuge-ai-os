"use client";

import { ArrowUpRight, BookOpen, CircleHelp, History } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@multica/ui/components/ui/dropdown-menu";
import { useConfigStore } from "@multica/core/config";

const DOCS_URL = "https://multica.ai/docs";
const CHANGELOG_URL = "https://multica.ai/changelog";

export function HelpLauncher() {
  const serverVersion = useConfigStore((state) => state.serverVersion);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Lab 說明"
        title="Lab 說明"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors cursor-pointer hover:bg-accent hover:text-foreground data-popup-open:bg-accent data-popup-open:text-foreground"
      >
        <CircleHelp className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" sideOffset={8} className="min-w-44 max-w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">Zhuge AI OS · Multica Lab</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<a href={DOCS_URL} target="_blank" rel="noopener noreferrer" />}>
          <BookOpen className="h-3.5 w-3.5" />
          上游 Multica 文件
          <ArrowUpRight className="size-3 translate-y-px text-faint-foreground" />
        </DropdownMenuItem>
        <DropdownMenuItem render={<a href={CHANGELOG_URL} target="_blank" rel="noopener noreferrer" />}>
          <History className="h-3.5 w-3.5" />
          上游變更紀錄
          <ArrowUpRight className="size-3 translate-y-px text-faint-foreground" />
        </DropdownMenuItem>
        {serverVersion && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="font-normal break-words text-muted-foreground">
                Lab Server · {serverVersion}
              </DropdownMenuLabel>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
