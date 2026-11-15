"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "@/components/locale-provider";

import { useEffect, useSyncExternalStore } from "react";

const storageKey = "adrobot-theme";
const changeEvent = "adrobot-theme-change";
type Theme = "system" | "light" | "dark";
let fallback: Theme = "system";

function getTheme(): Theme {
  try {
    const saved = localStorage.getItem(storageKey);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return fallback;
  }
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(changeEvent, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(changeEvent, callback);
  };
}

export function ThemeSelect() {
  const t = useTranslations();
  const theme = useSyncExternalStore(subscribe, getTheme, () => "system");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    function apply() {
      document.documentElement.classList.toggle(
        "dark",
        theme === "dark" || (theme === "system" && media.matches),
      );
    }
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  return (
    <div
      role="group"
      aria-label={t("colorTheme")}
      className="flex shrink-0 gap-0.5 rounded-lg border bg-muted/50 p-1"
    >
      {[
        { value: "system", label: t("systemTheme"), icon: Monitor },
        { value: "light", label: t("lightTheme"), icon: Sun },
        { value: "dark", label: t("darkTheme"), icon: Moon },
      ].map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          aria-pressed={theme === value}
          title={label}
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
          onClick={() => {
            fallback = value as Theme;
            try {
              localStorage.setItem(storageKey, fallback);
            } catch {
              // Keep the selection for this session when storage is unavailable.
            }
            window.dispatchEvent(new Event(changeEvent));
          }}
        >
          <Icon aria-hidden="true" className="size-4" />
        </button>
      ))}
    </div>
  );
}
