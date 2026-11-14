"use client";

import {
  ArrowLeft,
  ArrowRight,
  FolderOpen,
  Plus,
  RotateCw,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { getCampaigns, type CampaignPage } from "@/lib/campaigns";

const PAGE_SIZE = 20;
type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; page: CampaignPage };

export function CampaignList() {
  const [offset, setOffset] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    getCampaigns({ limit: PAGE_SIZE, offset, signal: controller.signal }).then(
      (page) => {
        if (!controller.signal.aborted) setState({ status: "ready", page });
      },
      () => {
        if (!controller.signal.aborted) setState({ status: "error" });
      },
    );
    return () => controller.abort();
  }, [offset, attempt]);

  function navigate(nextOffset: number) {
    setState({ status: "loading" });
    setOffset(nextOffset);
  }
  const loading = state.status === "loading";

  return (
    <section aria-labelledby="campaigns-title">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="mb-2 text-sm font-medium text-emerald-700">Keitaro</p>
          <h1
            id="campaigns-title"
            className="text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            Campaigns
          </h1>
          <p className="mt-3 text-muted-foreground">
            Your existing advertising campaigns, in one place.
          </p>
        </div>
        <Button disabled aria-describedby="creation-note" size="lg">
          <Plus aria-hidden="true" /> Create campaign
        </Button>
      </div>
      <p id="creation-note" className="mt-6 text-sm text-muted-foreground">
        Campaign creation and details are coming soon. You can browse existing
        campaigns below.
      </p>
      <div
        className="mt-6 overflow-hidden rounded-xl border bg-background"
        aria-busy={loading}
      >
        {loading && (
          <div
            role="status"
            className="px-6 py-16 text-center text-muted-foreground"
          >
            Loading campaigns…
          </div>
        )}
        {state.status === "error" && (
          <div className="px-6 py-16 text-center">
            <div role="alert">
              <h2 className="font-semibold">Couldn’t load campaigns</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Please try again.
              </p>
            </div>
            <Button
              variant="outline"
              className="mt-5"
              onClick={() => {
                setState({ status: "loading" });
                setAttempt((value) => value + 1);
              }}
            >
              <RotateCw aria-hidden="true" /> Retry
            </Button>
          </div>
        )}
        {state.status === "ready" && state.page.items.length === 0 && (
          <div role="status" className="px-6 py-16 text-center">
            <FolderOpen
              aria-hidden="true"
              className="mx-auto mb-4 size-8 text-muted-foreground"
            />
            <h2 className="font-semibold">
              {offset === 0 ? "No campaigns yet" : "No campaigns on this page"}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {offset === 0
                ? "Campaigns will appear here once they’re available in Keitaro."
                : "The campaign list may have changed. Go back to the previous page."}
            </p>
            {offset === 0 && (
              <Button
                disabled
                aria-describedby="creation-note"
                className="mt-5"
              >
                <Plus aria-hidden="true" /> Create campaign
              </Button>
            )}
          </div>
        )}
        {state.status === "ready" && state.page.items.length > 0 && (
          <ul aria-label="Campaigns" className="divide-y">
            {state.page.items.map((campaign) => (
              <li
                key={campaign.id}
                className="flex flex-wrap items-center justify-between gap-4 px-6 py-5"
              >
                <div className="min-w-0 flex-1">
                  <h2 className="font-medium [overflow-wrap:anywhere]">
                    {campaign.name || "Unnamed campaign"}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Keitaro ID: {campaign.id}
                  </p>
                </div>
                <Button
                  disabled
                  variant="outline"
                  aria-label={`Open details for ${campaign.name || "Unnamed campaign"}`}
                  aria-describedby="creation-note"
                >
                  Details <ArrowRight aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <nav
        aria-label="Campaign pagination"
        className="mt-5 flex flex-wrap items-center justify-between gap-4"
      >
        <p role="status" className="text-sm text-muted-foreground">
          Page {offset / PAGE_SIZE + 1}
          {state.status === "ready" && state.page.items.length > 0 && (
            <>
              {" "}
              · Showing {offset + 1}–{offset + state.page.items.length}
            </>
          )}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={loading || offset === 0}
            onClick={() => navigate(Math.max(0, offset - PAGE_SIZE))}
          >
            <ArrowLeft aria-hidden="true" /> Previous
          </Button>
          <Button
            variant="outline"
            disabled={state.status !== "ready" || !state.page.has_more}
            onClick={() => navigate(offset + PAGE_SIZE)}
          >
            Next <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </nav>
    </section>
  );
}
