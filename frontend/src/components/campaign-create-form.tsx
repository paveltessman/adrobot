"use client";

import type { MessageKey } from "@/lib/i18n";

import { ArrowLeft } from "lucide-react";
import { useTranslations } from "@/components/locale-provider";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { CreationOfferPicker } from "@/components/creation-offer-picker";
import {
  createCampaign,
  creationError,
  CreationRejectedError,
  CreationUnknownError,
  getCreationSelectors,
  parseCountryCodes,
  type CreationDraft,
  type CreationOption,
  type CreationSelectors,
} from "@/lib/campaign-create";
import { useDraftNavigation } from "@/lib/use-draft-navigation";

const emptyDraft: CreationDraft = {
  name: "",
  countryCodes: "",
  offer: null,
  domainId: "",
  groupId: "",
  sourceId: "",
};
const inputClass =
  "mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-60";
type OptionsState =
  | { status: "loading" | "error" }
  | { status: "ready"; values: CreationSelectors };
type Submission =
  | { status: "idle"; error?: MessageKey }
  | { status: "submitting" }
  | { status: "created"; campaignId: number }
  | { status: "partial" | "unknown"; campaignId: number | null };

function Selector({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: CreationOption[];
  onChange: (value: string) => void;
}) {
  const t = useTranslations();
  return (
    <div className="text-sm font-medium">
      <label htmlFor={`creation-${id}`}>{label}</label>
      <select
        id={`creation-${id}`}
        className={inputClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{t("none")}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name || t("unnamed")} (ID: {option.id})
          </option>
        ))}
      </select>
    </div>
  );
}

function Preview({
  draft,
  selectors,
  children,
}: {
  children: ReactNode;
  draft: CreationDraft;
  selectors?: CreationSelectors;
}) {
  const t = useTranslations();
  function option(options: CreationOption[] | undefined, value: string) {
    const selected = options?.find((item) => String(item.id) === value);
    return selected
      ? `${selected.name || t("unnamed")} (ID: ${selected.id})`
      : t("none");
  }
  return (
    <section
      aria-labelledby="creation-preview"
      className="rounded-xl border bg-background p-6 lg:sticky lg:top-6"
    >
      <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
        {t("preview")}
      </p>
      <h2
        id="creation-preview"
        className="mt-2 text-xl font-semibold [overflow-wrap:anywhere]"
      >
        {draft.name.trim() || t("newCampaign")}
      </h2>
      <dl className="mt-5 space-y-3 text-sm">
        {[
          [t("domain"), option(selectors?.domains, draft.domainId)],
          [t("campaignGroup"), option(selectors?.groups, draft.groupId)],
          [t("trafficSource"), option(selectors?.sources, draft.sourceId)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-1 [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
      <ol
        className="mt-6 space-y-4 border-t pt-5 text-sm"
        aria-label={t("plannedStreams")}
      >
        <li>
          <h3 className="font-semibold">{t("countryRedirect")}</h3>
          <p className="mt-2">
            {t("trafficCountries", {
              countries:
                parseCountryCodes(draft.countryCodes).join(", ") ||
                t("selectedCountries"),
            })}
          </p>
          <p className="mt-1 break-all text-muted-foreground">
            https://www.google.com
          </p>
        </li>
        <li>
          <h3 className="font-semibold">{t("offersStream")}</h3>
          <p className="mt-2">
            {t("remainingTraffic", {
              offer: draft.offer?.name || t("selectedOfferPlaceholder"),
            })}
          </p>
          <p className="mt-1 text-muted-foreground">
            {draft.offer
              ? t("initialOfferShare", { id: draft.offer.id })
              : t("selectOfferTraffic")}
          </p>
        </li>
      </ol>
      <p className="mt-5 border-t pt-4 text-sm text-muted-foreground">
        {t("pushToSave")}
      </p>
      {children}
    </section>
  );
}

export function CampaignCreateForm() {
  const t = useTranslations();
  const router = useRouter();
  const [draft, setDraft] = useState<CreationDraft>(emptyDraft);
  const [options, setOptions] = useState<OptionsState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [submission, setSubmission] = useState<Submission>({ status: "idle" });
  const [reviewed, setReviewed] = useState(false);
  const operation = useRef(false);
  const mounted = useRef(false);
  const busy = submission.status === "submitting";
  const blocked =
    submission.status === "partial" || submission.status === "unknown";
  const locked = busy || blocked || submission.status === "created";
  const dirty = Object.values(draft).some(
    (value) => value !== "" && value !== null,
  );
  const confirmLeave = useDraftNavigation(
    submission.status !== "created" && (dirty || busy || blocked),
    busy
      ? t("creationInProgressLeave")
      : blocked
        ? t("creationReviewLeave")
        : t("creationDiscardLeave"),
  );
  const validation = creationError(draft);
  const selectors = options.status === "ready" ? options.values : undefined;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    getCreationSelectors(controller.signal).then(
      (values) => {
        if (!controller.signal.aborted) setOptions({ status: "ready", values });
      },
      () => {
        if (!controller.signal.aborted) setOptions({ status: "error" });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  function update<K extends keyof CreationDraft>(
    key: K,
    value: CreationDraft[K],
  ) {
    if (locked) return;
    setDraft((current) => ({ ...current, [key]: value }));
    setSubmission({ status: "idle" });
  }
  async function push() {
    if (operation.current || locked || validation) return;
    operation.current = true;
    setSubmission({ status: "submitting" });
    try {
      const result = await createCampaign(draft);
      if (!mounted.current) return;
      if (result.status === "failed")
        setSubmission({
          status: "idle",
          error: "creationRejectedReview",
        });
      else {
        setSubmission(result);
        setReviewed(false);
        if (result.status === "created")
          router.replace(`/campaigns/${result.campaignId}`);
      }
    } catch (error) {
      if (!mounted.current) return;
      setReviewed(false);
      setSubmission(
        error instanceof CreationRejectedError
          ? { status: "idle", error: error.key }
          : {
              status: "unknown",
              campaignId:
                error instanceof CreationUnknownError ? error.campaignId : null,
            },
      );
    } finally {
      operation.current = false;
    }
  }

  return (
    <>
      <Link
        href="/"
        className={buttonVariants({ variant: "outline" })}
        onNavigate={(event) => {
          if (!confirmLeave()) event.preventDefault();
        }}
      >
        <ArrowLeft aria-hidden="true" /> {t("backCampaigns")}
      </Link>
      <div className="mt-8">
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {t("createCampaign")}
        </h1>
        <p className="mt-3 text-muted-foreground">{t("creationIntro")}</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("draftDiscardNotice")}
        </p>
      </div>
      <form
        className="mt-8"
        onSubmit={(event) => {
          event.preventDefault();
          void push();
        }}
      >
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <fieldset
            disabled={locked}
            className="min-w-0 space-y-6 rounded-xl border bg-background p-6"
          >
            <legend className="sr-only">{t("campaignSettings")}</legend>
            <label className="block text-sm font-medium">
              {t("campaignName")}
              <input
                className={inputClass}
                value={draft.name}
                required
                onChange={(event) => update("name", event.target.value)}
              />
            </label>
            <div className="text-sm font-medium">
              <label htmlFor="creation-country">{t("countryCodes")}</label>
              <input
                id="creation-country"
                className={`${inputClass} uppercase`}
                value={draft.countryCodes}
                required
                placeholder="AU, US"
                aria-describedby="country-help"
                onChange={(event) =>
                  update("countryCodes", event.target.value.toUpperCase())
                }
              />
              <span
                id="country-help"
                className="mt-2 block font-normal text-muted-foreground"
              >
                {t("countryHelp")}
              </span>
            </div>
            <CreationOfferPicker
              selected={draft.offer}
              onSelect={(offer) => update("offer", offer)}
              disabled={locked}
            />
            {options.status === "loading" && (
              <p role="status" className="text-sm">
                {t("loadingOptions")}
              </p>
            )}
            {options.status === "error" && (
              <div>
                <p role="alert" className="text-sm">
                  {t("optionsFailedOptional")}
                </p>
                <Button
                  type="button"
                  className="mt-3"
                  variant="outline"
                  onClick={() => {
                    setOptions({ status: "loading" });
                    setAttempt((value) => value + 1);
                  }}
                >
                  {t("retryOptions")}
                </Button>
              </div>
            )}
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("optionalSettings")}
              </p>
              <Selector
                id="domain"
                label={t("domain")}
                value={draft.domainId}
                options={selectors?.domains ?? []}
                onChange={(value) => update("domainId", value)}
              />
              <Selector
                id="group"
                label={t("campaignGroup")}
                value={draft.groupId}
                options={selectors?.groups ?? []}
                onChange={(value) => update("groupId", value)}
              />
              <Selector
                id="source"
                label={t("trafficSource")}
                value={draft.sourceId}
                options={selectors?.sources ?? []}
                onChange={(value) => update("sourceId", value)}
              />
            </div>
          </fieldset>
          <Preview draft={draft} selectors={selectors}>
            <div
              className="mt-5 border-t pt-5"
              aria-label={t("creationActions")}
              role="region"
            >
              {validation && !locked && (
                <p className="mb-3 text-sm text-muted-foreground">
                  {t(validation)}
                </p>
              )}
              {submission.status === "idle" && submission.error && (
                <p role="alert" className="mb-3 text-sm">
                  {t(submission.error)}
                </p>
              )}
              {busy && (
                <p role="status" className="mb-3 text-sm">
                  {t("creatingCampaign")}
                </p>
              )}
              {submission.status === "created" && (
                <p role="status" className="mb-3 text-sm">
                  {t("campaignCreated")}
                </p>
              )}
              {blocked && (
                <div className="mb-4 space-y-3 text-sm">
                  <p role="alert">
                    {submission.status === "partial"
                      ? t("creationIncomplete")
                      : t("creationUnknown")}{" "}
                    {t("creationKept")}
                  </p>
                  {submission.campaignId && (
                    <p>
                      {t("keitaroId", { id: submission.campaignId })} ·{" "}
                      <Link
                        className="font-medium underline"
                        href={`/campaigns/${submission.campaignId}`}
                        onNavigate={(event) => {
                          if (!confirmLeave()) event.preventDefault();
                        }}
                      >
                        {t("inspectCampaign")}
                      </Link>
                    </p>
                  )}
                  <label className="flex items-start gap-2">
                    <input
                      className="mt-1 accent-emerald-700"
                      type="checkbox"
                      checked={reviewed}
                      onChange={(event) => setReviewed(event.target.checked)}
                    />
                    {t("creationReviewed")}
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!reviewed}
                    onClick={() => {
                      if (reviewed) {
                        setSubmission({
                          status: "idle",
                          error: "nextPushCreates",
                        });
                        setReviewed(false);
                      }
                    }}
                  >
                    {t("enableCreation")}
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                <Button type="submit" disabled={locked || !!validation}>
                  {t("push")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || submission.status === "created"}
                  onClick={() => {
                    if (confirmLeave()) router.push("/");
                  }}
                >
                  {t("cancel")}
                </Button>
              </div>
            </div>
          </Preview>
        </div>
      </form>
    </>
  );
}
