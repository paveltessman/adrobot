"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { availableOffer } from "@/lib/campaign-create";
import type { Offer } from "@/lib/offers";
import { useOfferSearch } from "@/lib/use-offer-search";

export function CreationOfferPicker({
  selected,
  onSelect,
  disabled,
}: {
  selected: Offer | null;
  onSelect: (offer: Offer | null) => void;
  disabled: boolean;
}) {
  const t = useTranslations();
  const container = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const { query, search, changeQuery, searchNow } = useOfferSearch(disabled);
  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  function submitSearch() {
    setOpen(true);
    searchNow();
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
        {t("initialOffer")}
      </h2>
      <label htmlFor="offer-search" className="mt-3 block text-sm">
        {t("searchOffers")}
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
              setOpen(true);
              changeQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitSearch();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-expanded={open && !disabled && search.status !== "idle"}
            aria-controls="offer-search-dropdown"
            onClick={submitSearch}
          >
            {t("search")}
          </Button>
        </div>
        {open && !disabled && search.status !== "idle" && (
          <div
            id="offer-search-dropdown"
            className="absolute inset-x-0 top-full z-20 mt-2 max-h-72 overflow-y-auto rounded-lg border bg-background p-3 shadow-lg"
          >
            {search.status === "loading" && !disabled && (
              <p role="status" className="mt-3 text-sm">
                {t("searchingOffers")}
              </p>
            )}
            {search.status === "error" && (
              <p role="alert" className="mt-3 text-sm">
                {t("searchRetry")}
              </p>
            )}
            {search.status === "ready" &&
              (search.offers.length === 0 ? (
                <p role="status" className="mt-3 text-sm text-muted-foreground">
                  {t("noOffersFound")}
                </p>
              ) : (
                <ul aria-label={t("searchResults")} className="mt-3 divide-y">
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
                            {offer.name || t("unnamedOffer")}
                          </span>
                          <span className="mt-1 block text-muted-foreground">
                            {t("offerId", { id: offer.id })}
                            {!availableOffer(offer) && t("unavailableSuffix")}
                          </span>
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {selected?.id === offer.id ? t("selected") : ""}
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
        <div className="mt-3 rounded-lg bg-emerald-50 dark:bg-emerald-950 p-3 text-sm">
          <p className="font-medium [overflow-wrap:anywhere]">
            {t("selectedOffer", { name: selected.name || t("unnamedOffer") })}
          </p>
          <p className="mt-1">{t("offerId", { id: selected.id })}</p>
          <Button
            type="button"
            variant="outline"
            className="mt-2"
            disabled={disabled}
            onClick={() => onSelect(null)}
          >
            {t("clearOffer")}
          </Button>
        </div>
      )}
    </section>
  );
}
