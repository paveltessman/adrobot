"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { CreationOfferPicker } from "@/components/creation-offer-picker";
import {
  createCampaign,
  creationError,
  CreationRejectedError,
  CreationUnknownError,
  getCreationSelectors,
  type CreationDraft,
  type CreationOption,
  type CreationSelectors,
} from "@/lib/campaign-create";
import { useDraftNavigation } from "@/lib/use-draft-navigation";

const emptyDraft: CreationDraft = {
  name: "",
  countryCode: "",
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
  | { status: "idle"; error?: string }
  | { status: "submitting" }
  | { status: "created"; campaignId: number }
  | { status: "partial" | "unknown"; campaignId: number | null };

function Selector({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: CreationOption[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="text-sm font-medium">
      <label htmlFor={`creation-${label.replaceAll(" ", "-")}`}>{label}</label>
      <select
        id={`creation-${label.replaceAll(" ", "-")}`}
        className={inputClass}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
      >
        <option value="">
          {options.length
            ? `Select ${label.toLowerCase()}`
            : `No ${label.toLowerCase()} options available`}
        </option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name || "Unnamed"} (ID: {option.id})
          </option>
        ))}
      </select>
    </div>
  );
}

function Preview({
  draft,
  selectors,
}: {
  draft: CreationDraft;
  selectors?: CreationSelectors;
}) {
  function option(options: CreationOption[] | undefined, value: string) {
    const selected = options?.find((item) => String(item.id) === value);
    return selected
      ? `${selected.name || "Unnamed"} (ID: ${selected.id})`
      : "Not selected";
  }
  return (
    <section
      aria-labelledby="creation-preview"
      className="rounded-xl border bg-background p-6 lg:sticky lg:top-6"
    >
      <p className="text-sm font-medium text-emerald-700">Preview</p>
      <h2
        id="creation-preview"
        className="mt-2 text-xl font-semibold [overflow-wrap:anywhere]"
      >
        {draft.name.trim() || "New campaign"}
      </h2>
      <dl className="mt-5 space-y-3 text-sm">
        {[
          ["Domain", option(selectors?.domains, draft.domainId)],
          ["Campaign group", option(selectors?.groups, draft.groupId)],
          ["Traffic source", option(selectors?.sources, draft.sourceId)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-1 [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
      <ol
        className="mt-6 space-y-4 border-t pt-5 text-sm"
        aria-label="Planned streams"
      >
        <li>
          <h3 className="font-semibold">1. Country redirect</h3>
          <p className="mt-2">
            Traffic from{" "}
            {draft.countryCode.trim().toUpperCase() || "the selected country"} →
            Google
          </p>
          <p className="mt-1 break-all text-muted-foreground">
            https://www.google.com
          </p>
        </li>
        <li>
          <h3 className="font-semibold">2. Offers</h3>
          <p className="mt-2">
            All remaining traffic → {draft.offer?.name || "the selected offer"}
          </p>
          <p className="mt-1 text-muted-foreground">
            {draft.offer
              ? `Offer ID: ${draft.offer.id} · Traffic share: 100%`
              : "Select an offer to receive 100% of this stream’s traffic."}
          </p>
        </li>
      </ol>
      <p className="mt-5 border-t pt-4 text-sm text-muted-foreground">
        Nothing is created until you Push.
      </p>
    </section>
  );
}

export function CampaignCreateForm() {
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
      ? "Creation is still in progress. Leaving will not cancel it. Leave this page?"
      : blocked
        ? "The creation outcome needs review in Keitaro. Discard this draft and leave?"
        : "Discard the campaign draft and leave this page?",
  );
  const validation = creationError(draft);
  const selectors = options.status === "ready" ? options.values : undefined;
  const missingOptions =
    selectors &&
    (!selectors.domains.length ||
      !selectors.groups.length ||
      !selectors.sources.length);

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
    if (
      operation.current ||
      locked ||
      validation ||
      !selectors ||
      missingOptions
    )
      return;
    operation.current = true;
    setSubmission({ status: "submitting" });
    try {
      const result = await createCampaign(draft);
      if (!mounted.current) return;
      if (result.status === "failed")
        setSubmission({
          status: "idle",
          error:
            "Creation was rejected. Review your selections before trying again.",
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
          ? { status: "idle", error: error.message }
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
        <ArrowLeft aria-hidden="true" /> Back to campaigns
      </Link>
      <div className="mt-8">
        <p className="text-sm font-medium text-emerald-700">Campaign creator</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          Create campaign
        </h1>
        <p className="mt-3 text-muted-foreground">
          Choose your resources and preview the two streams before pushing.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Reloading or leaving discards this draft.
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
            <legend className="sr-only">Campaign settings</legend>
            <label className="block text-sm font-medium">
              Campaign name
              <input
                className={inputClass}
                value={draft.name}
                required
                onChange={(event) => update("name", event.target.value)}
              />
            </label>
            <div className="text-sm font-medium">
              <label htmlFor="creation-country">Country code</label>
              <input
                id="creation-country"
                className={`${inputClass} uppercase`}
                value={draft.countryCode}
                required
                maxLength={2}
                pattern="[A-Za-z]{2}"
                placeholder="AU"
                aria-describedby="country-help"
                onChange={(event) =>
                  update("countryCode", event.target.value.toUpperCase())
                }
              />
              <span
                id="country-help"
                className="mt-2 block font-normal text-muted-foreground"
              >
                Two-letter country code. Traffic from this country goes to
                Google.
              </span>
            </div>
            <CreationOfferPicker
              selected={draft.offer}
              onSelect={(offer) => update("offer", offer)}
              disabled={locked}
            />
            {options.status === "loading" && (
              <p role="status" className="text-sm">
                Loading campaign options…
              </p>
            )}
            {options.status === "error" && (
              <div>
                <p role="alert" className="text-sm">
                  Could not load campaign options.
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
                  Retry options
                </Button>
              </div>
            )}
            {selectors && (
              <div className="space-y-4">
                <Selector
                  label="Domain"
                  value={draft.domainId}
                  options={selectors.domains}
                  onChange={(value) => update("domainId", value)}
                />
                <Selector
                  label="Campaign group"
                  value={draft.groupId}
                  options={selectors.groups}
                  onChange={(value) => update("groupId", value)}
                />
                <Selector
                  label="Traffic source"
                  value={draft.sourceId}
                  options={selectors.sources}
                  onChange={(value) => update("sourceId", value)}
                />
                {missingOptions && (
                  <p role="alert" className="text-sm">
                    A domain, campaign group, and traffic source must be
                    available in Keitaro before you can create a campaign.
                  </p>
                )}
              </div>
            )}
          </fieldset>
          <Preview draft={draft} selectors={selectors} />
        </div>
        <div
          className="sticky bottom-0 z-10 mt-6 rounded-xl border bg-background p-5 shadow-sm"
          aria-label="Creation actions"
          role="region"
        >
          {validation && !locked && (
            <p className="mb-3 text-sm text-muted-foreground">{validation}</p>
          )}
          {submission.status === "idle" && submission.error && (
            <p role="alert" className="mb-3 text-sm">
              {submission.error}
            </p>
          )}
          {busy && (
            <p role="status" className="mb-3 text-sm">
              Creating campaign…
            </p>
          )}
          {submission.status === "created" && (
            <p role="status" className="mb-3 text-sm">
              Campaign created successfully. Opening its details…
            </p>
          )}
          {blocked && (
            <div className="mb-4 space-y-3 text-sm">
              <p role="alert">
                {submission.status === "partial"
                  ? "The campaign exists, but its configuration is incomplete."
                  : "The creation outcome is unknown."}{" "}
                Your draft has been kept. Check Keitaro before submitting again;
                another attempt can create a duplicate campaign.
              </p>
              {submission.campaignId && (
                <p>
                  Keitaro ID: {submission.campaignId} ·{" "}
                  <Link
                    className="font-medium underline"
                    href={`/campaigns/${submission.campaignId}`}
                    onNavigate={(event) => {
                      if (!confirmLeave()) event.preventDefault();
                    }}
                  >
                    Inspect campaign
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
                I checked Keitaro and want to make a new creation attempt.
              </label>
              <Button
                type="button"
                variant="outline"
                disabled={!reviewed}
                onClick={() => {
                  if (reviewed) {
                    setSubmission({
                      status: "idle",
                      error: "The next Push will create a new campaign.",
                    });
                    setReviewed(false);
                  }
                }}
              >
                Enable a new creation attempt
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <Button
              type="submit"
              disabled={
                locked || !!validation || !selectors || !!missingOptions
              }
            >
              Push
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || submission.status === "created"}
              onClick={() => {
                if (confirmLeave()) router.push("/");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
