import { ArrowDown, Bot, GitBranch, Globe2, Layers2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";

const workflows = [
  {
    title: "Create a campaign",
    description:
      "Set a name, country, and offer. Configure the domain, group, and traffic source for your campaign.",
    icon: Globe2,
  },
  {
    title: "Manage offers",
    description:
      "Add and remove offers within an existing campaign from one focused workspace.",
    icon: Layers2,
  },
];

export default function Home() {
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
      <main id="main" className="mx-auto max-w-5xl px-6 py-16 sm:py-24">
        <Badge variant="outline" className="mb-6 bg-background">
          Keitaro campaign management
        </Badge>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
          A focused workspace for your campaigns.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted-foreground">
          Create campaigns, configure traffic routing, and manage offers in one
          place.
        </p>
        <Button
          render={<a href="#workflows" />}
          nativeButton={false}
          size="lg"
          className="mt-8"
        >
          Explore the workspace
          <ArrowDown aria-hidden="true" />
        </Button>

        <section
          id="workflows"
          aria-labelledby="workflows-title"
          className="mt-20 scroll-mt-8"
        >
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <h2
              id="workflows-title"
              className="text-xl font-semibold tracking-tight"
            >
              Campaign workflows
            </h2>
            <Badge variant="secondary">Coming soon</Badge>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            {workflows.map(({ title, description, icon: Icon }) => (
              <Card key={title} className="gap-5 p-2 py-6 shadow-none">
                <CardHeader>
                  <Icon
                    aria-hidden="true"
                    className="mb-4 size-6 text-emerald-700"
                  />
                  <h3 className="text-lg font-medium">{title}</h3>
                  <CardDescription className="mt-2 leading-relaxed">
                    {description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  Planned for the next stage
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="mt-6 flex items-start gap-2 text-sm leading-relaxed text-muted-foreground">
            <GitBranch aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            Campaign tools are being built. Live campaign data will appear once
            the workspace is connected.
          </p>
        </section>
      </main>
      <footer className="mx-auto max-w-5xl border-t px-6 py-6 text-xs text-muted-foreground">
        Adrobot · Built for focused campaign operations
      </footer>
    </div>
  );
}
