import { Bot } from "lucide-react";
import Link from "next/link";

import type { ReactNode } from "react";

export function Workspace({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-stone-50">
      <a
        href="#main"
        className="sr-only rounded-md bg-background p-3 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10"
      >
        Skip to content
      </a>
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-5 sm:gap-6">
          <div className="flex shrink-0 items-center gap-3 font-semibold tracking-tight">
            <span className="rounded-lg bg-primary p-2 text-primary-foreground">
              <Bot aria-hidden="true" className="size-5" />
            </span>
            Adrobot
          </div>
          <nav aria-label="Sections" className="min-w-0 overflow-x-auto">
            <Link
              href="/"
              aria-current="true"
              className="block whitespace-nowrap border-x px-4 py-2 text-sm font-semibold text-primary decoration-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-6"
            >
              Campaigns
            </Link>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
        {children}
      </main>
    </div>
  );
}
