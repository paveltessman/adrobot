"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { CampaignStream } from "@/lib/campaign-details";
import {
  addOffer,
  membershipStatus,
  removeOffer,
  setPinned,
  type StreamDraft,
} from "@/lib/campaign-draft";
import {
  getOffer,
  OfferUnavailableError,
  searchOffers,
  type Offer,
} from "@/lib/offers";

export function StreamOfferEditor({
  stream,
  showRemoved,
  draft,
  setDraft,
}: {
  stream: CampaignStream;
  showRemoved: boolean;
  draft: StreamDraft;
  setDraft: (update: (current: StreamDraft) => StreamDraft) => void;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    offers: Offer[];
  }>({ status: "idle", offers: [] });
  const [pending, setPending] = useState<number | null>(null);
  const [messages, setMessages] = useState<Record<number, string>>({});
  const [unavailable, setUnavailable] = useState<ReadonlySet<number>>(
    new Set(),
  );
  const searchRequest = useRef<AbortController | null>(null);
  const lookupRequest = useRef<AbortController | null>(null);
  const [searchAttempt, setSearchAttempt] = useState(0);
  useEffect(() => {
    if (!query.trim() && searchAttempt === 0) return;
    const controller = new AbortController();
    searchRequest.current = controller;
    const timer = setTimeout(async () => {
      setSearch({ status: "loading", offers: [] });
      try {
        const offers = await searchOffers(query, controller.signal);
        if (!controller.signal.aborted) setSearch({ status: "ready", offers });
      } catch {
        if (!controller.signal.aborted)
          setSearch({ status: "error", offers: [] });
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, searchAttempt]);
  useEffect(
    () => () => {
      searchRequest.current?.abort();
      lookupRequest.current?.abort();
    },
    [],
  );

  async function stageOffer(id: number) {
    lookupRequest.current?.abort();
    const controller = new AbortController();
    lookupRequest.current = controller;
    setPending(id);
    setMessages((current) => ({ ...current, [id]: "" }));
    try {
      const offer = await getOffer(id, controller.signal);
      if (!controller.signal.aborted)
        setDraft((current) => addOffer(current, offer));
    } catch (error) {
      if (!controller.signal.aborted) {
        setMessages((current) => ({
          ...current,
          [id]:
            error instanceof OfferUnavailableError
              ? error.message
              : "Could not check offer availability. Please try again.",
        }));
        if (error instanceof OfferUnavailableError)
          setUnavailable((current) => new Set([...current, id]));
      }
    } finally {
      if (!controller.signal.aborted) setPending(null);
    }
  }

  const visible = draft.offers.filter(
    (offer) =>
      offer.attached ||
      showRemoved ||
      membershipStatus(draft, offer.id) === "pending removal",
  );

  return (
    <>
      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSearchAttempt((current) => current + 1);
        }}
      >
        <label
          className="min-w-0 flex-1 text-sm"
          htmlFor={`offer-search-${stream.id}`}
        >
          Search offers by name or ID
          <input
            id={`offer-search-${stream.id}`}
            value={query}
            onChange={(event) => {
              searchRequest.current?.abort();
              setQuery(event.target.value);
              setSearchAttempt(0);
              setSearch({ status: "idle", offers: [] });
            }}
            className="mt-1 block w-full rounded-lg border bg-background px-3 py-2"
          />
        </label>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
      {search.status === "loading" && (
        <p role="status" className="mt-3 text-sm">
          Searching offers…
        </p>
      )}
      {search.status === "error" && (
        <p role="alert" className="mt-3 text-sm">
          Could not search offers. Please try again.
        </p>
      )}
      {search.status === "ready" &&
        (search.offers.length === 0 ? (
          <p role="status" className="mt-3 text-sm">
            No matching offers.
          </p>
        ) : (
          <ul
            aria-label="Offer search results"
            className="mt-3 divide-y rounded-lg border px-3"
          >
            {search.offers.map((offer) => {
              const attached = draft.offers.some(
                (item) => item.id === offer.id && item.attached,
              );
              const blocked =
                unavailable.has(offer.id) ||
                ["deleted", "archived"].includes(offer.state);
              return (
                <li
                  key={offer.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {offer.name || "Unnamed offer"} · ID: {offer.id}
                  </span>
                  <Button
                    variant="outline"
                    disabled={attached || blocked || pending !== null}
                    onClick={() => void stageOffer(offer.id)}
                  >
                    {attached
                      ? "Already attached"
                      : blocked
                        ? "Unavailable"
                        : pending === offer.id
                          ? "Checking…"
                          : "Add"}
                  </Button>
                  {messages[offer.id] && (
                    <p role="alert" className="w-full text-sm">
                      {messages[offer.id]}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        ))}
      {draft.error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {draft.error}
        </p>
      )}
      {visible.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No offers attached to this stream.
        </p>
      ) : (
        <ul
          className="mt-3 divide-y"
          aria-label={`Offers in ${stream.name || `stream ${stream.id}`}`}
        >
          {visible.map((offer) => {
            const status = membershipStatus(draft, offer.id);
            const label = status.charAt(0).toUpperCase() + status.slice(1);
            const previous = draft.baseline.find(
              (item) => item.id === offer.id,
            );
            const shareChanged =
              offer.attached &&
              (!previous?.attached || previous.share !== offer.share);
            return (
              <li
                key={offer.id}
                className="flex flex-wrap items-start justify-between gap-3 py-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium [overflow-wrap:anywhere]">
                    {offer.name || "Unnamed offer"}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Offer ID: {offer.id} · {label}
                  </p>
                  {offer.attached ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      Membership: {offer.membershipState} · Offer: {offer.state}
                    </p>
                  ) : (
                    status === "removed" && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        Last known offer status: {offer.state}.{" "}
                        {!messages[offer.id] &&
                          "Current availability has not been checked."}
                      </p>
                    )
                  )}
                  {messages[offer.id] && (
                    <p role="alert" className="mt-2 text-sm">
                      {messages[offer.id]}
                    </p>
                  )}
                </div>
                <div className="space-y-2 text-sm">
                  {(shareChanged || status === "pending removal") && (
                    <p className="text-muted-foreground">
                      Current traffic: {previous?.attached ? previous.share : 0}
                      %
                    </p>
                  )}
                  {offer.attached ? (
                    <>
                      <p>
                        {shareChanged ? "Proposed traffic" : "Traffic share"}:{" "}
                        <span className="font-semibold">{offer.share}%</span>
                        {offer.pinned && " · Pinned"}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          disabled={!offer.pinned && draft.error !== null}
                          onClick={() =>
                            setDraft((current) =>
                              setPinned(current, offer.id, !offer.pinned),
                            )
                          }
                        >
                          {offer.pinned ? "Unpin" : "Pin"}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() =>
                            setDraft((current) =>
                              removeOffer(current, offer.id),
                            )
                          }
                        >
                          Remove
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      {status === "pending removal" && (
                        <p>Proposed traffic: 0%</p>
                      )}
                      <p className="text-muted-foreground">
                        No traffic allocated
                      </p>
                      <Button
                        variant="outline"
                        disabled={pending !== null || unavailable.has(offer.id)}
                        onClick={() => void stageOffer(offer.id)}
                      >
                        {pending === offer.id ? "Checking…" : "Restore"}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
