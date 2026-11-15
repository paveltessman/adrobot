"use client";

import {
  ArrowLeft,
  ArrowRight,
  FolderOpen,
  Plus,
  RotateCw,
} from "lucide-react";
import { useTranslations } from "@/components/locale-provider";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { getCampaigns, type CampaignPage } from "@/lib/campaigns";

const PAGE_SIZE = 20;
type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; page: CampaignPage };

export function CampaignList() {
  const t = useTranslations();
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
      <h1 id="campaigns-title" className="sr-only">
        {t("campaigns")}
      </h1>
      <div className="flex justify-end">
        <Link href="/campaigns/new" className={buttonVariants({ size: "lg" })}>
          <Plus aria-hidden="true" /> {t("createCampaign")}
        </Link>
      </div>
      <div
        className="mt-6 overflow-hidden rounded-xl border bg-background"
        aria-busy={loading}
      >
        {loading && (
          <div
            role="status"
            className="px-6 py-16 text-center text-muted-foreground"
          >
            {t("loadingCampaigns")}
          </div>
        )}
        {state.status === "error" && (
          <div className="px-6 py-16 text-center">
            <div role="alert">
              <h2 className="font-semibold">{t("campaignsLoadFailed")}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {t("tryAgain")}
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
              <RotateCw aria-hidden="true" /> {t("retry")}
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
              {offset === 0 ? t("noCampaigns") : t("noCampaignsOnPage")}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {offset === 0 ? t("campaignsAppear") : t("listChanged")}
            </p>
            {offset === 0 && (
              <Link
                href="/campaigns/new"
                className={buttonVariants({ className: "mt-5" })}
              >
                <Plus aria-hidden="true" /> {t("createCampaign")}
              </Link>
            )}
          </div>
        )}
        {state.status === "ready" && state.page.items.length > 0 && (
          <ul aria-label={t("campaigns")} className="divide-y">
            {state.page.items.map((campaign) => (
              <li
                key={campaign.id}
                className="flex flex-wrap items-center justify-between gap-4 px-6 py-5"
              >
                <div className="min-w-0 flex-1">
                  <h2 className="font-medium [overflow-wrap:anywhere]">
                    {campaign.name || t("unnamedCampaign")}
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("keitaroId", { id: campaign.id })}
                  </p>
                </div>
                <Link
                  href={`/campaigns/${campaign.id}`}
                  className={buttonVariants({ variant: "outline" })}
                  aria-label={t("openDetails", {
                    name: campaign.name || t("unnamedCampaign"),
                  })}
                >
                  {t("details")}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      <nav
        aria-label={t("pagination")}
        className="mt-5 flex flex-wrap items-center justify-between gap-4"
      >
        <p role="status" className="text-sm text-muted-foreground">
          {t("page", { page: offset / PAGE_SIZE + 1 })}
          {state.status === "ready" && state.page.items.length > 0 && (
            <>
              {" "}
              {t("showingRange", {
                first: offset + 1,
                last: offset + state.page.items.length,
              })}
            </>
          )}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={loading || offset === 0}
            onClick={() => navigate(Math.max(0, offset - PAGE_SIZE))}
          >
            <ArrowLeft aria-hidden="true" /> {t("previous")}
          </Button>
          <Button
            variant="outline"
            disabled={state.status !== "ready" || !state.page.has_more}
            onClick={() => navigate(offset + PAGE_SIZE)}
          >
            {t("next")}
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      </nav>
    </section>
  );
}
