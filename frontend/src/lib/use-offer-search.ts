"use client";

import { useEffect, useRef, useState } from "react";
import { searchOffers, type Offer } from "./offers";

type SearchState = {
  status: "idle" | "loading" | "ready" | "error";
  offers: Offer[];
};

export function useOfferSearch(disabled = false) {
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState<SearchState>({
    status: "idle",
    offers: [],
  });
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    if (disabled || (!query.trim() && attempt === 0)) return;
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

  function changeQuery(value: string) {
    request.current?.abort();
    setQuery(value);
    setAttempt(0);
    setSearch({ status: value.trim() ? "loading" : "idle", offers: [] });
  }

  function searchNow() {
    if (disabled) return;
    request.current?.abort();
    setSearch({ status: "loading", offers: [] });
    setAttempt((current) => current + 1);
  }

  return { query, search, changeQuery, searchNow };
}
