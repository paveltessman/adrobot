import { Bot } from "lucide-react";

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
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-3 font-semibold tracking-tight">
            <span className="rounded-lg bg-primary p-2 text-primary-foreground">
              <Bot aria-hidden="true" className="size-5" />
            </span>
            Adrobot
          </div>
          <span className="text-sm text-muted-foreground">
            Campaign workspace
          </span>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-6 py-12 sm:py-16">
        {children}
      </main>
    </div>
  );
}
