# Storage plan

This document records the storage decisions supporting the planned interface in [ui.md](ui.md). These are decisions for future implementation; the current backend fetches campaign details directly from Keitaro without persisting this history.

## State ownership

| State                                                                  | Storage                                                              | Purpose                                                            |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Current campaign configuration, streams, and attached offers           | Fetched from Keitaro through the backend and held in frontend memory | Confirmed baseline for display and editing                         |
| Previously observed stream offers and their last known display details | Application database, accessed through SQLAlchemy                    | Identify removed memberships across reloads and later sessions     |
| Committed offer pins                                                   | Application database, accessed through SQLAlchemy                    | Preserve app preferences across successful pushes and later visits |
| Pending additions, removals, restorations, and pin changes             | Frontend memory                                                      | Preview changes until Push or Cancel                               |

Keitaro is authoritative for campaign configuration and current stream membership. The application database is authoritative for observed membership history and committed pin preferences.

## Observed offers and removals

Retain a membership record scoped to the Keitaro instance, campaign, stream, and offer. It must retain the offer identity, last known display details such as its name, and whether it was attached at the last successful refresh.

After a complete successful load of a stream's membership and required offer details, compare its current membership with the stored history:

- Record newly observed memberships and update last known display details.
- Mark previously observed memberships that are no longer present as removed.
- Mark memberships that reappear as attached again.

Failed or incomplete loads must not mark memberships as removed. Offers removed before the application ever observed them cannot appear in this history.

A removed membership means that the offer is detached from that stream. It does not mean that the underlying offer was deleted from Keitaro. Offer availability is a separate fact: check it before allowing restoration, and keep the historical entry visible with an explanation when restoration is unavailable.

Restoring or adding a previously removed offer reuses its existing membership entry. History must survive reloads and later sessions.

## Drafts and pins

Keep the last confirmed baseline and the proposed draft separately in frontend memory. Draft changes must not modify Keitaro or committed pin preferences before Push.

- Cancel discards the draft, including draft pin changes, and returns to the last confirmed state.
- Push sends the proposed changes and enough baseline information for the backend to detect changes made directly in Keitaro. The backend must check the affected stream before applying changes and require a refreshed preview if it has changed.
- After a successful Push, reload confirmed state, update persisted history and committed pins, and clear the draft.
- If Push fails, preserve the draft. If some writes succeeded, reconcile with Keitaro and show the remaining unapplied changes. Persisted history and pins must reflect the reconciled outcome rather than treating the whole draft as successful.

Committed pins are application preferences scoped to a stream and offer. Preserve them across successful pushes and later visits. Removing a pinned offer releases its allocation; restoring an offer starts unpinned.

Drafts are not persisted in the database or browser storage. Reloading or leaving the page discards them, so warn before navigation while changes are pending. Recovering drafts after reload is outside the current scope.

## Offer search

Search available Keitaro offers by name or ID through the application backend. Do not limit search to the application's observed-offer history: that history contains only offers previously loaded for streams and is not a complete offer catalog.

The public API documents `GET /offers` and `GET /offers/{id}`, but no offer-search endpoint or pagination parameters on `GET /offers`. Fetch the accessible offer catalog through the backend and filter it there by name or ID; an exact numeric ID can also use the individual lookup. Search results may be cached for responsiveness, but Keitaro remains authoritative for offer availability. The backend must validate selected offers when applying changes.

## Keitaro API verification

Checked the public [Admin API v1 OpenAPI schema](https://admin-api.docs.keitaro.io/openapi.json) and [reference](https://admin-api.docs.keitaro.io/) on 2026-11-14. This is documentation verification, not testing against our deployed tracker; undocumented behavior must not be assumed.

| Capability | Documented support |
| ---------- | ------------------ |
| Read membership | `GET /campaigns/{id}/streams` and `GET /streams/{id}` return offers, shares, states, and timestamps. |
| Edit membership and allocation | `PUT /streams/{id}` accepts an `offers` array of `offer_id`, integer `share` (percentage), and optional `state` (`active` or `disabled`). |
| Offer catalog and lookup | `GET /offers`, `GET /offers/{id}`; no documented offer search or list pagination. |
| Archived offer entities | `GET /offers/deleted` and `POST /offers/{id}/restore`; these concern whole offers, not detached memberships. |
| Creation selectors | `GET /domains`, `GET /groups?type=campaigns`, and `GET /traffic_sources`. |
| Drafts, pins, detached-membership history | No dedicated documented capability. |
| Conditional writes, multi-request transactions, idempotency keys | No documented mechanism. Stream `updated_at` is readable, not a documented write precondition. |

### Application consequences

Use whole-percentage precision for offer allocation. Do not confuse offer `share` with the separate stream `weight` field. The schema does not specify share bounds, sum validation, or normalization behavior; verify those against the target tracker before implementing writes.

Keep drafts, pins, and observed membership history as described above. Archived-offer endpoints cannot reconstruct which offers were detached from which streams. Restoring a membership must not implicitly restore an archived offer entity.

Send the complete proposed offer list when updating a stream. Keitaro's [official MCP documentation](https://docs.keitaro.io/en/settings/mcp.html) explicitly describes replacement of offer lists on stream changes; verify the same behavior for direct Admin API writes on the target version. Preserve existing membership states and avoid sending unrelated stream fields.

Compare a canonical snapshot of the affected stream's membership, shares, states, and relevant routing configuration immediately before writing. Do not rely solely on timestamps. This detects already-visible external edits but cannot prevent an edit between the read and write: strict atomic conflict protection is not established by the public API. An application lock can serialize our own pushes only.

Treat Push as a sequence of remote operations with possible partial completion. A database transaction cannot roll back Keitaro writes. After success or an uncertain outcome, reload remote state and reconcile history, pins, and the remaining draft. Avoid blindly retrying campaign creation after a timeout because no idempotency guarantee is documented.

### Remaining implementation verification

- Test the target version's offer-list completeness, archive visibility, permissions, and unavailable-offer responses using read-only requests.
- In a disposable campaign, verify offer-array replacement, omitted-field preservation, share validation, and whether membership edits always advance stream timestamps.
- Decide the database schema and reconciliation rules for history, pins, and partial Push failures.

Keitaro's [Admin API guide](https://docs.keitaro.io/en/development/admin-api.html) recommends inspecting the tracker UI's network requests to clarify behavior not covered by the public reference. No live tracker requests or mutations were made during this verification.
