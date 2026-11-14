"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { availableOffer } from "@/lib/campaign-create";
import { searchOffers, type Offer } from "@/lib/offers";

export function CreationOfferPicker({
  selected,
  onSelect,
  disabled,
}: {
  selected: Offer | null;
  onSelect: (offer: Offer | null) => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState<{
    status: "idle" | "loading" | "ready" | "error";
    offers: Offer[];
  }>({ status: "idle", offers: [] });
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    if ((!query.trim() && !attempt) || disabled) return;
    const controller = new AbortController();
    request.current = controller;
    const timer = setTimeout(async () => {
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
  }, [query, attempt, disabled]);
  function searchNow() {
    request.current?.abort();
    setSearch({ status: "loading", offers: [] });
    setAttempt((current) => current + 1);
  }
  return (
    <section aria-labelledby="initial-offer-title">
      <h2 id="initial-offer-title" className="font-semibold">
        Initial offer
      </h2>
      <label htmlFor="offer-search" className="mt-3 block text-sm">
        Search offers by name or ID
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          id="offer-search"
          value={query}
          disabled={disabled}
          className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
          onChange={(event) => {
            request.current?.abort();
            setQuery(event.target.value);
            setSearch({
              status: event.target.value.trim() || attempt ? "loading" : "idle",
              offers: [],
            });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              searchNow();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={searchNow}
        >
          Search
        </Button>
      </div>
      {selected && (
        <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm">
          <p className="font-medium [overflow-wrap:anywhere]">
            Selected offer: {selected.name || "Unnamed offer"}
          </p>
          <p className="mt-1">Offer ID: {selected.id}</p>
          <Button
            type="button"
            variant="outline"
            className="mt-2"
            disabled={disabled}
            onClick={() => onSelect(null)}
          >
            Clear offer
          </Button>
        </div>
      )}
      {search.status === "loading" && !disabled && (
        <p role="status" className="mt-3 text-sm">
          Searching offers…
        </p>
      )}
      {search.status === "error" && (
        <p role="alert" className="mt-3 text-sm">
          Could not search offers. Use Search to retry.
        </p>
      )}
      {search.status === "ready" &&
        (search.offers.length === 0 ? (
          <p role="status" className="mt-3 text-sm text-muted-foreground">
            No offers found.
          </p>
        ) : (
          <ul aria-label="Offer search results" className="mt-3 divide-y">
            {search.offers.map((offer) => (
              <li
                key={offer.id}
                className="flex items-start justify-between gap-3 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium [overflow-wrap:anywhere]">
                    {offer.name || "Unnamed offer"}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    Offer ID: {offer.id}
                    {!availableOffer(offer) && " · Unavailable"}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    disabled ||
                    !availableOffer(offer) ||
                    selected?.id === offer.id
                  }
                  onClick={() => onSelect(offer)}
                >
                  {selected?.id === offer.id ? "Selected" : "Select"}
                </Button>
              </li>
            ))}
          </ul>
        ))}
    </section>
  );
}
