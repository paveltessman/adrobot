"use client";

import { displayState, type MessageKey } from "@/lib/i18n";

import { useEffect, useRef, useState } from "react";
import { useTranslations, useLocale } from "@/components/locale-provider";
import { Button } from "@/components/ui/button";
import { useOfferSearch } from "@/lib/use-offer-search";
import type { CampaignStream } from "@/lib/campaign-details";
import {
  addOffer,
  membershipStatus,
  removeOffer,
  setPinned,
  type StreamDraft,
} from "@/lib/campaign-draft";
import { getOffer, OfferUnavailableError } from "@/lib/offers";

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
  const t = useTranslations();
  const locale = useLocale();
  const container = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const { query, search, changeQuery, searchNow } = useOfferSearch();
  const [pending, setPending] = useState<number | null>(null);
  const [messages, setMessages] = useState<Partial<Record<number, MessageKey>>>(
    {},
  );
  const [unavailable, setUnavailable] = useState<ReadonlySet<number>>(
    new Set(),
  );
  const lookupRequest = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      lookupRequest.current?.abort();
    },
    [],
  );

  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);

  async function stageOffer(id: number) {
    lookupRequest.current?.abort();
    const controller = new AbortController();
    lookupRequest.current = controller;
    setPending(id);
    setMessages((current) => ({ ...current, [id]: undefined }));
    try {
      const offer = await getOffer(id, controller.signal);
      if (!controller.signal.aborted) {
        setDraft((current) => addOffer(current, offer));
        container.current?.querySelector("input")?.focus();
        setOpen(false);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setMessages((current) => ({
          ...current,
          [id]:
            error instanceof OfferUnavailableError
              ? error.key
              : "availabilityFailed",
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
      <div
        ref={container}
        className="relative mt-4"
        onBlur={(event) => {
          // Disabling a focused result during lookup can blur it without
          // moving focus elsewhere. Keep lookup progress and errors visible.
          if (
            event.relatedTarget &&
            !event.currentTarget.contains(event.relatedTarget)
          )
            setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            container.current?.querySelector("input")?.focus();
            setOpen(false);
          }
        }}
      >
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setOpen(true);
            searchNow();
          }}
        >
          <label
            className="min-w-0 flex-1 text-sm"
            htmlFor={`offer-search-${stream.id}`}
          >
            {t("searchOffers")}
            <input
              id={`offer-search-${stream.id}`}
              value={query}
              onFocus={() => setOpen(true)}
              onClick={() => setOpen(true)}
              onChange={(event) => {
                setOpen(true);
                changeQuery(event.target.value);
              }}
              className="mt-1 block w-full rounded-lg border bg-background px-3 py-2"
            />
          </label>
          <Button
            type="submit"
            variant="outline"
            aria-expanded={open && search.status !== "idle"}
            aria-controls={`offer-search-dropdown-${stream.id}`}
          >
            {t("search")}
          </Button>
        </form>
        {open && search.status !== "idle" && (
          <div
            id={`offer-search-dropdown-${stream.id}`}
            className="absolute inset-x-0 top-full z-20 mt-2 max-h-72 overflow-y-auto rounded-lg border bg-background p-3 shadow-lg"
          >
            {search.status === "loading" && (
              <p role="status" className="mt-3 text-sm">
                {t("searchingOffers")}
              </p>
            )}
            {search.status === "error" && (
              <p role="alert" className="mt-3 text-sm">
                {t("searchFailed")}
              </p>
            )}
            {search.status === "ready" &&
              (search.offers.length === 0 ? (
                <p role="status" className="mt-3 text-sm">
                  {t("noMatchingOffers")}
                </p>
              ) : (
                <ul aria-label={t("searchResults")} className="mt-3 divide-y">
                  {search.offers.map((offer) => {
                    const attached = draft.offers.some(
                      (item) => item.id === offer.id && item.attached,
                    );
                    const blocked =
                      unavailable.has(offer.id) ||
                      ["deleted", "archived"].includes(offer.state);
                    return (
                      <li key={offer.id}>
                        <button
                          type="button"
                          className="flex w-full items-start justify-between gap-3 rounded-md px-3 py-3 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={attached || blocked || pending !== null}
                          onClick={() => void stageOffer(offer.id)}
                        >
                          <span className="min-w-0 [overflow-wrap:anywhere]">
                            {offer.name || t("unnamedOffer")} · ID: {offer.id}
                          </span>
                          <span className="shrink-0 text-muted-foreground">
                            {attached
                              ? t("alreadyAttached")
                              : blocked
                                ? t("unavailable")
                                : pending === offer.id
                                  ? t("checking")
                                  : ""}
                          </span>
                        </button>
                        {messages[offer.id] && (
                          <p role="alert" className="w-full text-sm">
                            {t(messages[offer.id]!)}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ))}
          </div>
        )}
      </div>
      {draft.error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {t(draft.error)}
        </p>
      )}
      {visible.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {t("noAttachedOffers")}
        </p>
      ) : (
        <ul
          className="mt-3 divide-y"
          aria-label={t("offersIn", {
            stream: stream.name || t("streamFallback", { id: stream.id }),
          })}
        >
          {visible.map((offer) => {
            const status = membershipStatus(draft, offer.id);
            const label = t(
              (
                {
                  attached: "attached",
                  "pending addition": "pendingAddition",
                  "pending removal": "pendingRemoval",
                  removed: "removed",
                } as const
              )[status],
            );
            const previous = draft.baseline.find(
              (item) => item.id === offer.id,
            );
            const shareChanged =
              offer.attached &&
              (!previous?.attached || previous.share !== offer.share);
            return (
              <li
                key={offer.id}
                className={`flex flex-wrap items-start justify-between gap-3 py-4 ${!offer.attached ? "rounded-md bg-muted/50 px-3 text-muted-foreground" : ""}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium [overflow-wrap:anywhere]">
                    {offer.name || t("unnamedOffer")}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("offerId", { id: offer.id })} · {label}
                  </p>
                  {offer.attached ? (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {t("membershipOffer", {
                        membership: displayState(locale, offer.membershipState),
                        state: displayState(locale, offer.state),
                      })}
                    </p>
                  ) : (
                    status === "removed" && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t("historicalOfferState", {
                          state: displayState(locale, offer.state),
                        })}{" "}
                        {!messages[offer.id] && t("availabilityUnchecked")}
                      </p>
                    )
                  )}
                  {messages[offer.id] && (
                    <p role="alert" className="mt-2 text-sm">
                      {t(messages[offer.id]!)}
                    </p>
                  )}
                </div>
                <div className="space-y-2 text-sm">
                  {(shareChanged || status === "pending removal") && (
                    <p className="text-muted-foreground">
                      {t("currentTraffic", {
                        share: previous?.attached ? previous.share : 0,
                      })}
                    </p>
                  )}
                  {offer.attached ? (
                    <>
                      <p>
                        {shareChanged
                          ? t("proposedTraffic")
                          : t("trafficShare")}
                        : <span className="font-semibold">{offer.share}%</span>
                        {offer.pinned && t("pinnedSuffix")}
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
                          {offer.pinned ? t("unpin") : t("pin")}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() =>
                            setDraft((current) =>
                              removeOffer(current, offer.id),
                            )
                          }
                        >
                          {t("remove")}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      {status === "pending removal" && (
                        <p>{t("proposedTraffic")}: 0%</p>
                      )}
                      <p className="text-muted-foreground">{t("noTraffic")}</p>
                      <Button
                        variant="outline"
                        disabled={pending !== null || unavailable.has(offer.id)}
                        onClick={() => void stageOffer(offer.id)}
                      >
                        {pending === offer.id ? t("checking") : t("restore")}
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
