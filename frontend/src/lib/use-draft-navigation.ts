"use client";

import { useEffect } from "react";

const defaultMessage = "Discard pending offer changes and leave this page?";

// The project's TypeScript DOM definitions predate the Navigation API.
interface HistoryNavigateEvent extends Event {
  navigationType: string;
  destination: { url: string; sameDocument: boolean };
}

export function useDraftNavigation(
  dirty: boolean,
  message = defaultMessage,
): () => boolean {
  useEffect(() => {
    if (!dirty) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    function navigate(event: Event) {
      const navigationEvent = event as HistoryNavigateEvent;
      if (
        navigationEvent.navigationType !== "traverse" ||
        !navigationEvent.destination.sameDocument ||
        !event.cancelable
      )
        return;
      const destination = new URL(navigationEvent.destination.url);
      if (
        destination.pathname === window.location.pathname &&
        destination.search === window.location.search
      )
        return;
      if (!window.confirm(message)) event.preventDefault();
    }
    const navigation = (window as Window & { navigation?: EventTarget })
      .navigation;
    window.addEventListener("beforeunload", beforeUnload);
    navigation?.addEventListener("navigate", navigate);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      navigation?.removeEventListener("navigate", navigate);
    };
  }, [dirty, message]);

  // Next.js links use onNavigate, since pushState is not cancellable.
  return () => !dirty || window.confirm(message);
}
