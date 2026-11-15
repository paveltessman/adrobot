"use client";

import { useEffect, useRef, useState } from "react";
import type { MessageKey } from "./i18n";
import { hasChanges, type StreamDraft } from "./campaign-draft";
import {
  CampaignNotFoundError,
  getCampaignDetails,
  type CampaignDetails,
} from "./campaign-details";
import {
  confirmedDrafts,
  proposedChanges,
  pushCampaign,
  PushRejectedError,
  reconcileDrafts,
} from "./campaign-push";

type CampaignEditorState =
  | { status: "loading" }
  | { status: "error" | "missing" }
  | {
      status: "ready";
      campaign: CampaignDetails;
      drafts: Record<number, StreamDraft>;
      revision: number;
      sync: "idle" | "pushing" | "checking" | "unknown";
      feedback: { kind: "success" | "error"; message: MessageKey } | null;
    };

export function useCampaignEditor(campaignId: number) {
  const validId = Number.isSafeInteger(campaignId) && campaignId > 0;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<CampaignEditorState>({
    status: "loading",
  });
  const operation = useRef(false);
  const epoch = useRef(0);
  const busy =
    state.status === "ready" && ["pushing", "checking"].includes(state.sync);
  const dirty =
    state.status === "ready" && Object.values(state.drafts).some(hasChanges);
  const shouldWarnLeave =
    dirty || busy || (state.status === "ready" && state.sync === "unknown");
  useEffect(() => {
    if (!validId) return;
    const controller = new AbortController();
    getCampaignDetails(campaignId, controller.signal).then(
      (campaign) => {
        if (!controller.signal.aborted)
          setState({
            status: "ready",
            campaign,
            revision: 0,
            drafts: confirmedDrafts(campaign),
            sync: "idle",
            feedback: null,
          });
      },
      (error) => {
        if (!controller.signal.aborted)
          setState({
            status:
              error instanceof CampaignNotFoundError ? "missing" : "error",
          });
      },
    );
    return () => {
      controller.abort();
      epoch.current += 1;
      operation.current = false;
    };
  }, [campaignId, validId, attempt]);

  async function synchronize(checkOnly = false) {
    if (state.status !== "ready" || operation.current) return;
    if (!checkOnly && state.sync === "unknown") return;
    let changes;
    try {
      changes = proposedChanges(state.drafts);
    } catch {
      return;
    }
    if (!changes.length && !checkOnly) return;
    const snapshot = state;
    const started = epoch.current;
    operation.current = true;
    setState({
      ...state,
      revision: state.revision + 1,
      sync: checkOnly ? "checking" : "pushing",
      feedback: null,
    });
    try {
      const result = checkOnly
        ? {
            status: "checked" as const,
            campaign: await getCampaignDetails(campaignId),
            pending_streams: changes,
          }
        : await pushCampaign(campaignId, changes);
      const campaign = result.campaign;
      if (started !== epoch.current) return;
      if (!campaign) {
        setState((current) =>
          current.status !== "ready"
            ? current
            : {
                ...current,
                sync: "unknown",
                feedback: {
                  kind: "error",
                  message: "pushUnknown",
                },
              },
        );
        return;
      }
      const pendingIds = result.pending_streams.map(
        (change) => change.stream_id,
      );
      const drafts = reconcileDrafts(campaign, snapshot.drafts, pendingIds);
      const remaining = Object.values(drafts).some(hasChanges);
      setState({
        status: "ready",
        campaign,
        drafts,
        revision: snapshot.revision + 2,
        sync: "idle",
        feedback:
          result.status === "checked"
            ? {
                kind: remaining ? "error" : "success",
                message: remaining ? "checkedRemaining" : "checkedNoPending",
              }
            : result.status === "applied"
              ? { kind: "success", message: "savedSuccessfully" }
              : {
                  kind: "error",
                  message:
                    result.status === "partial" ? "savedPartially" : "notSaved",
                },
      });
    } catch (error) {
      if (started !== epoch.current) return;
      const rejected = !checkOnly && error instanceof PushRejectedError;
      setState((current) =>
        current.status !== "ready"
          ? current
          : {
              ...current,
              sync: rejected ? "idle" : "unknown",
              feedback: {
                kind: "error",
                message: rejected
                  ? error.key
                  : checkOnly
                    ? "checkFailed"
                    : "pushUnconfirmed",
              },
            },
      );
    } finally {
      if (started === epoch.current) operation.current = false;
    }
  }

  function retry() {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }

  function updateDraft(
    streamId: number,
    update: (current: StreamDraft) => StreamDraft,
  ) {
    setState((current) => {
      // Ignore lookups belonging to a draft canceled or synchronized since they started.
      if (
        current.status !== "ready" ||
        state.status !== "ready" ||
        current.revision !== state.revision ||
        current.sync !== "idle" ||
        !current.drafts[streamId]
      )
        return current;
      return {
        ...current,
        drafts: {
          ...current.drafts,
          [streamId]: update(current.drafts[streamId]),
        },
      };
    });
  }

  function cancel() {
    setState((current) =>
      current.status !== "ready" || current.sync !== "idle"
        ? current
        : {
            ...current,
            revision: current.revision + 1,
            drafts: confirmedDrafts(current.campaign),
            feedback: null,
          },
    );
  }

  return {
    state,
    validId,
    busy,
    shouldWarnLeave,
    retry,
    updateDraft,
    cancel,
    push: () => synchronize(),
    checkSaved: () => synchronize(true),
  };
}
