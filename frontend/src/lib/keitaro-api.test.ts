import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import {
  createCampaign,
  CreationUnknownError,
  getCreationSelectors,
} from "./campaign-create.ts";
import { getCampaignDetails } from "./campaign-details.ts";
import { pushCampaign, PushRejectedError } from "./campaign-push.ts";
import { getCampaigns } from "./campaigns.ts";
import { getOffer, searchOffers } from "./offers.ts";

afterEach(() => mock.restoreAll());

const draft = {
  name: "Campaign",
  countryCodes: "AU",
  offer: { id: 9, name: "Offer", state: "active" },
  domainId: "",
  groupId: "",
  sourceId: "",
};
const changes = [
  {
    stream_id: 1,
    offers: [{ offer_id: 9, share: 100, state: "active" }],
    pinned_offer_ids: [],
  },
];

for (const [name, load, message] of [
  ["campaign list", () => getCampaigns(), /invalid response/],
  ["campaign details", () => getCampaignDetails(7), /invalid response/],
  ["offer search", () => searchOffers("sun"), /invalid response/],
  ["offer lookup", () => getOffer(9), /invalid response/],
  [
    "creation selectors",
    () => getCreationSelectors(),
    /Invalid campaign options/,
  ],
] as const) {
  test(`${name} rejects malformed envelopes and invalid JSON without exposing details`, async () => {
    for (const body of [
      "private upstream response",
      "null",
      "[]",
      JSON.stringify({ error: null }),
      JSON.stringify({ data: [] }),
      JSON.stringify({ data: [], error: { message: "private" } }),
    ]) {
      mock.method(globalThis, "fetch", async () => new Response(body));
      await assert.rejects(load(), message);
      mock.restoreAll();
    }
  });
}

test("malformed mutation envelopes remain uncertain and never trigger retries", async () => {
  for (const body of [
    "private upstream response",
    "null",
    "[]",
    JSON.stringify({ error: null }),
    JSON.stringify({ data: {} }),
    JSON.stringify({ data: {}, error: { message: "private" } }),
  ]) {
    const fetchMock = mock.method(
      globalThis,
      "fetch",
      async () => new Response(body),
    );
    await assert.rejects(createCampaign(draft), CreationUnknownError);
    await assert.rejects(
      pushCampaign(7, changes),
      (error: unknown) =>
        error instanceof Error &&
        !(error instanceof PushRejectedError) &&
        error.message === "Could not confirm the Push response.",
    );
    assert.equal(fetchMock.mock.callCount(), 2);
    mock.restoreAll();
  }
});

test("creation retains the campaign ID even when the envelope reports an error", async () => {
  mock.method(globalThis, "fetch", async () =>
    Response.json({
      data: { campaign_id: 7 },
      error: { message: "private upstream details" },
    }),
  );
  await assert.rejects(
    createCampaign(draft),
    (error: unknown) =>
      error instanceof CreationUnknownError && error.campaignId === 7,
  );
});
