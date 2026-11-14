"use client";

import Link from "next/link";
import { ArrowLeft, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  CampaignNotFoundError,
  getCampaignDetails,
  type CampaignDetails,
  type CampaignStream,
} from "@/lib/campaign-details";

type LoadState =
  | { status: "loading" }
  | { status: "error" | "missing" }
  | { status: "ready"; campaign: CampaignDetails };

function Fields({ values }: { values: [string, string | number | null][] }) {
  return (
    <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {values.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {value === null || value === "" ? "Not provided" : value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function StreamView({ stream }: { stream: CampaignStream }) {
  return (
    <section
      aria-labelledby={`stream-${stream.id}`}
      className="rounded-xl border bg-background p-6"
    >
      <h3
        id={`stream-${stream.id}`}
        className="text-xl font-semibold [overflow-wrap:anywhere]"
      >
        {stream.name || "Unnamed stream"}
      </h3>
      <p className="mt-1 mb-5 text-sm text-muted-foreground">
        Stream ID: {stream.id}
      </p>
      <Fields
        values={[
          ["Routing", stream.schema],
          ["Type", stream.type],
          ["Status", stream.state],
          ["Action", stream.action_type],
        ]}
      />
      {stream.schema === "redirect" && (
        <div className="mt-5">
          <p className="text-sm text-muted-foreground">Destination</p>
          <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {typeof stream.action_payload === "string"
              ? stream.action_payload || "Not provided"
              : JSON.stringify(stream.action_payload)}
          </p>
        </div>
      )}
      {stream.filters.length > 0 && (
        <details className="mt-5">
          <summary className="cursor-pointer text-sm font-medium">
            Stream filters
          </summary>
          <pre className="mt-3 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">
            {JSON.stringify(stream.filters, null, 2)}
          </pre>
        </details>
      )}
      <h4 className="mt-7 font-medium">Offers</h4>
      {stream.offers.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No offers attached to this stream.
        </p>
      ) : (
        <ul
          className="mt-3 divide-y"
          aria-label={`Offers in ${stream.name || `stream ${stream.id}`}`}
        >
          {stream.offers.map((membership) => {
            const offer = stream.offer_details.find(
              (item) => item.id === membership.offer_id,
            )!;
            return (
              <li
                key={membership.offer_id}
                className="flex flex-wrap items-start justify-between gap-3 py-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium [overflow-wrap:anywhere]">
                    {offer.name || "Unnamed offer"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Offer ID: {offer.id} · Attached
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Membership: {membership.state} · Offer: {offer.state}
                  </p>
                </div>
                <p className="text-sm">
                  Traffic share:{" "}
                  <span className="font-semibold">{membership.share}%</span>
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function CampaignDetailsView({ campaignId }: { campaignId: number }) {
  const validId = Number.isSafeInteger(campaignId) && campaignId > 0;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoadState>({ status: "loading" });
  useEffect(() => {
    if (!validId) return;
    const controller = new AbortController();
    getCampaignDetails(campaignId, controller.signal).then(
      (campaign) => {
        if (!controller.signal.aborted) setState({ status: "ready", campaign });
      },
      (error) => {
        if (!controller.signal.aborted)
          setState({
            status:
              error instanceof CampaignNotFoundError ? "missing" : "error",
          });
      },
    );
    return () => controller.abort();
  }, [campaignId, validId, attempt]);

  return (
    <>
      <Link href="/" className={buttonVariants({ variant: "outline" })}>
        <ArrowLeft aria-hidden="true" /> Back to campaigns
      </Link>
      {!validId || state.status === "missing" ? (
        <div role="alert" className="mt-8">
          <h1 className="text-3xl font-semibold">Campaign not found</h1>
          <p className="mt-3 text-muted-foreground">
            This campaign is unavailable. Return to the campaign list to choose
            another.
          </p>
        </div>
      ) : state.status === "loading" ? (
        <div role="status" className="py-16 text-center text-muted-foreground">
          Loading campaign…
        </div>
      ) : state.status === "error" ? (
        <div className="py-16 text-center">
          <div role="alert">
            <h1 className="text-xl font-semibold">Couldn’t load campaign</h1>
            <p className="mt-3 text-muted-foreground">Please try again.</p>
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
      ) : (
        state.status === "ready" && (
          <>
            <div className="mt-8">
              <p className="text-sm font-medium text-emerald-700">
                Campaign details
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight [overflow-wrap:anywhere]">
                {state.campaign.name || "Unnamed campaign"}
              </h1>
              <p className="mt-3 text-muted-foreground">
                Keitaro ID: {state.campaign.id}
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                View campaign configuration and offers. Offer editing is coming
                soon.
              </p>
            </div>
            <section
              aria-labelledby="configuration-title"
              className="mt-8 rounded-xl border bg-background p-6"
            >
              <h2
                id="configuration-title"
                className="mb-5 text-xl font-semibold"
              >
                Configuration
              </h2>
              <Fields
                values={[
                  ["Alias", state.campaign.alias],
                  ["Status", state.campaign.state],
                  ["Domain ID", state.campaign.domain_id],
                  ["Group ID", state.campaign.group_id],
                  ["Traffic source ID", state.campaign.traffic_source_id],
                  ["Updated", state.campaign.updated_at],
                  ["Notes", state.campaign.notes],
                ]}
              />
            </section>
            <section aria-labelledby="streams-title" className="mt-10">
              <h2 id="streams-title" className="text-2xl font-semibold">
                Streams
              </h2>
              {state.campaign.streams.length === 0 ? (
                <p className="mt-4 text-muted-foreground">
                  No streams in this campaign.
                </p>
              ) : (
                <div className="mt-5 space-y-5">
                  {state.campaign.streams.map((stream) => (
                    <StreamView key={stream.id} stream={stream} />
                  ))}
                </div>
              )}
            </section>
          </>
        )
      )}
    </>
  );
}
