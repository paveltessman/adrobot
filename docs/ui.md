# UI plan

This document describes the planned campaign management interface. It extends the project requirements in [about.md](about.md); these are requirements for future implementation.

## Campaign list

The main page (`/`) displays the list of campaigns.

- Each campaign shows its name and Keitaro ID and opens its details page when selected.
- A **Create campaign** button opens the campaign creation form.
- Loading, empty, and failed-to-load states are explicit. The empty state includes the create action; errors include a retry action.

## Create campaign

The form collects the fields required by the campaign creator:

- Campaign name.
- Country geo-code.
- Initial offer, selected by searching existing Keitaro offers by name or ID.
- Domain, group, and traffic source, selected from resources available in Keitaro.

Every new campaign has two fixed streams: the country-filtered stream that redirects to Google, and the stream that redirects to the selected offer. The UI does not provide stream creation controls.

Before submission, show a preview of the campaign and these two streams. **Push** creates the campaign in Keitaro and opens its details page after success. **Cancel** discards the draft and returns to the campaign list. No campaign is created before Push.

## Campaign details

The details page shows the campaign name, ID, configured details, and its offers. Provide a way back to the campaign list. After creation, only offers can be edited: adding, removing, restoring, and pinning their traffic allocations. Campaign details and stream configuration are read-only; editing them is out of scope.

Group offers by stream, showing each stream's name and Keitaro ID. Display all campaign streams, including empty streams with an explicit empty state. Streams remain visible even when they have no offers to show under the current Show removed setting. For redirect streams, show their destination, including Google where applicable.

Offer membership and traffic distribution belong to a stream. Each offer stream has its own offer list and add/search controls, including when it is empty. Keep each stream's changes and distribution separate; never combine offers from different streams into one distribution. In campaigns created by this app, offer editing applies to the offer-routing stream; it must preserve the country-filtered Google stream. Users cannot create streams through this interface.

The offer list shows:

- Offer name and Keitaro ID.
- Current traffic percentage and proposed percentage when it changes.
- Whether the percentage is pinned.
- Membership status: attached, pending addition, pending removal, or removed.
- Applicable actions: **Remove**, **Restore**, and **Pin/Unpin**.

Users can search existing Keitaro offers by name or ID and add them to the stream. An already attached offer cannot be added twice. Adding a previously removed offer restores its existing entry.

Removing an offer detaches it from the stream; it does not delete the offer itself from Keitaro.

## Removed offers and restoration

Provide a **Show removed** toggle, off by default. When enabled, the list also includes offers previously observed in the stream that are no longer attached, including removals made through this app and directly in Keitaro.

The app must retain the identity and last known display details of every offer it has loaded for that stream. This history must survive reloads and later sessions. A successful refresh compares the current stream membership with this history to identify removals made directly in Keitaro. Failed or incomplete loads must not mark offers as removed. Offers removed before the app ever observed them cannot be shown.

**Restore** stages reattaching the offer to its original stream and includes it in the proposed traffic distribution. Restoration is applied only on Push. If the underlying offer itself has been deleted from Keitaro or is otherwise unavailable, show the historical entry with an explanation and disable restoration.

Removed offers receive no traffic and do not participate in balancing. Keep pending removals visible until the draft is pushed or canceled, even when Show removed is off.

## Traffic balancing and pins

Percentages are balanced within the stream being edited. The proposed distribution must total 100% across attached offers, including pending additions and restorations and excluding pending removals.

- Without pins, split traffic equally among the proposed attached offers.
- Pinning an offer fixes its currently displayed proposed percentage. Adding, removing, or restoring other offers must preserve that percentage.
- Divide the remaining percentage equally among unpinned offers.
- Unpinning an offer returns it to automatic balancing.
- Removing a pinned offer releases its allocation. Restoring a removed offer starts unpinned.
- Pin state is an app preference associated with the stream and offer; preserve it across successful pushes and later visits. Draft pin changes are discarded by Cancel.

Use the precision supported by Keitaro. Allocate rounding remainders deterministically among unpinned offers, without changing pinned percentages, so the total remains exactly 100%.

Examples at whole-percentage precision:

| Action                                 | Proposed distribution                        |
| -------------------------------------- | -------------------------------------------- |
| Three unpinned offers                  | 33%, 33%, 34%                                |
| Add a fourth offer                     | 25%, 25%, 25%, 25%                           |
| Pin an offer at 33%, then add a fourth | 33% pinned; the others receive 22%, 22%, 23% |

If no valid distribution is possible, explain the problem and disable Push. Examples include removing the last offer, pinned allocations exceeding 100%, or all remaining offers being pinned to a total below 100%. Do not silently change a pin to make the distribution valid.

## Preview, Push, and Cancel

All edits first update a local draft. The page immediately previews proposed offer membership, pin state, and traffic percentages, with additions, removals, and changed allocations clearly marked. Editing alone must not modify Keitaro.

Show a change summary and persistent **Push** and **Cancel** actions while there are pending changes.

- **Push** validates the draft and synchronizes the proposed changes with Keitaro. Disable repeat submission while it is in progress. On success, reload the confirmed state, clear the draft, and show success feedback.
- **Cancel** discards all pending changes, including pin changes, and returns to the last confirmed state without writing to Keitaro.
- Disable Push when there are no changes or validation fails.
- If synchronization fails, show the error and preserve the draft for correction or retry. If some writes succeeded, reconcile with Keitaro and show what remains unapplied; do not claim the entire operation succeeded or was rolled back.
- For now, assume campaign edits are made only through this frontend. Push validates the proposed changes but does not check whether the stream changed since the draft started. Concurrent edits from another browser tab or user, or directly in Keitaro, can be overwritten. External-change detection is deferred.
- Warn before leaving a page with pending changes, allowing the user to stay or discard them.

## Implementation decisions to verify

- The public API defines offer shares as integer percentages; use whole-percentage precision. Verify share validation and normalization against the target tracker before implementing writes. See [storage.md](storage.md#keitaro-api-verification) for verified capabilities and remaining checks.
