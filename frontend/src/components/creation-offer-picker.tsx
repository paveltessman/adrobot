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
  const container = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
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
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  function searchNow() {
    setOpen(true);
    request.current?.abort();
    setSearch({ status: "loading", offers: [] });
    setAttempt((current) => current + 1);
  }
  return (
    <section
      ref={container}
      aria-labelledby="initial-offer-title"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          container.current?.querySelector("input")?.focus();
          setOpen(false);
        }
      }}
    >
      <h2 id="initial-offer-title" className="font-semibold">
        Initial offer
      </h2>
      <label htmlFor="offer-search" className="mt-3 block text-sm">
        Search offers by name or ID
      </label>
      <div className="relative mt-2">
        <div className="flex flex-wrap gap-2">
          <input
            id="offer-search"
            value={query}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            disabled={disabled}
            className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
            onChange={(event) => {
              request.current?.abort();
              setOpen(true);
              setQuery(event.target.value);
              setSearch({
                status:
                  event.target.value.trim() || attempt ? "loading" : "idle",
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
            aria-expanded={open && !disabled && search.status !== "idle"}
            aria-controls="offer-search-dropdown"
            onClick={searchNow}
          >
            Search
          </Button>
        </div>
        {open && !disabled && search.status !== "idle" && (
          <div
            id="offer-search-dropdown"
            className="absolute inset-x-0 top-full z-20 mt-2 max-h-72 overflow-y-auto rounded-lg border bg-background p-3 shadow-lg"
          >
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
                    <li key={offer.id}>
                      <button
                        type="button"
                        className="flex w-full items-start justify-between gap-3 rounded-md px-3 py-3 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={
                          disabled ||
                          !availableOffer(offer) ||
                          selected?.id === offer.id
                        }
                        onClick={() => {
                          onSelect(offer);
                          container.current?.querySelector("input")?.focus();
                          setOpen(false);
                        }}
                      >
                        <span className="min-w-0">
                          <span className="block font-medium [overflow-wrap:anywhere]">
                            {offer.name || "Unnamed offer"}
                          </span>
                          <span className="mt-1 block text-muted-foreground">
                            Offer ID: {offer.id}
                            {!availableOffer(offer) && " · Unavailable"}
                          </span>
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {selected?.id === offer.id ? "Selected" : ""}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
          </div>
        )}
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
    </section>
  );
}
