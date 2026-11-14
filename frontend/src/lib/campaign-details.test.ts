import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import {
  CampaignNotFoundError,
  getCampaignDetails,
} from "./campaign-details.ts";

const campaign = {
  id: 7,
  name: "Campaign",
  alias: null,
  state: "active",
  domain_id: null,
  group_id: 3,
  traffic_source_id: null,
  notes: null,
  updated_at: null,
  streams: [
    {
      id: 1,
      campaign_id: 7,
      name: "Stream",
      type: "regular",
      state: "active",
      position: 1,
      schema: "landings",
      action_type: "http",
      action_payload: {},
      filters: [],
      offers: [{ offer_id: 9, share: 100, state: "active" }],
      offer_details: [{ id: 9, name: "Offer", state: "active" }],
      removed_offers: [
        { id: 10, name: "Old offer", last_known_state: "active" },
      ],
    },
  ],
};
afterEach(() => mock.restoreAll());

for (const action_payload of [[], null]) {
  test(`loads ${JSON.stringify(action_payload)} action payload with three offers`, async () => {
    const offers = [9, 10, 11].map((id) => ({
      id,
      name: `Offer ${id}`,
      state: "active",
    }));
    const data = {
      ...campaign,
      streams: [
        {
          ...campaign.streams[0],
          action_payload,
          offers: offers.map(({ id }) => ({
            offer_id: id,
            share: 100,
            state: "active",
          })),
          offer_details: offers,
          removed_offers: [],
        },
      ],
    };
    mock.method(globalThis, "fetch", async () =>
      Response.json({ data, error: null }),
    );
    assert.deepEqual(await getCampaignDetails(7), data);
  });
}

test("loads full details without caching and forwards cancellation", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    Response.json({ data: campaign, error: null }),
  );
  const signal = new AbortController().signal;
  assert.deepEqual(await getCampaignDetails(7, signal), campaign);
  assert.deepEqual(fetchMock.mock.calls[0].arguments, [
    "/api/v1/integrations/keitaro/campaigns/7",
    { cache: "no-store", signal },
  ]);
});

test("accepts campaigns without streams and redirect streams without offers", async () => {
  for (const streams of [
    [],
    [
      {
        ...campaign.streams[0],
        schema: "redirect",
        action_payload: "https://google.com",
        offers: [],
        offer_details: [],
      },
    ],
  ]) {
    const data = { ...campaign, streams };
    mock.method(globalThis, "fetch", async () =>
      Response.json({ data, error: null }),
    );
    assert.deepEqual(await getCampaignDetails(7), data);
    mock.restoreAll();
  }
});

for (const data of [
  null,
  {},
  { ...campaign, id: 8 },
  { ...campaign, notes: 1 },
  { ...campaign, streams: null },
  { ...campaign, streams: [{ ...campaign.streams[0], campaign_id: 8 }] },
  { ...campaign, streams: [{ ...campaign.streams[0], offers: null }] },
  { ...campaign, streams: [{ ...campaign.streams[0], offer_details: [] }] },
  ...[
    undefined,
    null,
    {},
    [{ id: 0, name: "Old", last_known_state: "active" }],
    [{ id: 10, name: 1, last_known_state: "active" }],
    [{ id: 10, name: "Old", last_known_state: null }],
    [{ id: 9, name: "Attached", last_known_state: "active" }],
    [
      campaign.streams[0].removed_offers[0],
      campaign.streams[0].removed_offers[0],
    ],
  ].map((removed_offers) => ({
    ...campaign,
    streams: [{ ...campaign.streams[0], removed_offers }],
  })),
  {
    ...campaign,
    streams: [
      {
        ...campaign.streams[0],
        offer_details: [{ id: 10, name: "Other", state: "active" }],
      },
    ],
  },
  { ...campaign, streams: [campaign.streams[0], campaign.streams[0]] },
  {
    ...campaign,
    streams: [
      {
        ...campaign.streams[0],
        offers: [{ offer_id: 9, share: "100", state: "active" }],
      },
    ],
  },
]) {
  test(`rejects incomplete or mismatched details: ${JSON.stringify(data)}`, async () => {
    mock.method(globalThis, "fetch", async () =>
      Response.json({ data, error: null }),
    );
    await assert.rejects(getCampaignDetails(7), /invalid response/);
  });
}

for (const status of [401, 422, 500, 502, 504]) {
  test(`handles HTTP ${status} without exposing private details`, async () => {
    mock.method(
      globalThis,
      "fetch",
      async () => new Response("private", { status }),
    );
    await assert.rejects(getCampaignDetails(7), {
      message: "Unable to load campaign. Please try again.",
    });
  });
}

test("distinguishes a missing campaign", async () => {
  mock.method(
    globalThis,
    "fetch",
    async () => new Response("private", { status: 404 }),
  );
  await assert.rejects(getCampaignDetails(7), CampaignNotFoundError);
});

test("rejects invalid JSON and error envelopes", async () => {
  for (const response of [
    new Response("invalid"),
    Response.json({ data: campaign, error: { code: "ERROR" } }),
  ]) {
    mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(getCampaignDetails(7), /invalid response/);
    mock.restoreAll();
  }
});

test("rejects invalid IDs without fetching", async () => {
  const fetchMock = mock.method(globalThis, "fetch");
  for (const id of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    await assert.rejects(getCampaignDetails(id), RangeError);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("preserves network and cancellation errors", async () => {
  for (const error of [
    new TypeError("Offline"),
    new DOMException("Canceled", "AbortError"),
  ]) {
    mock.method(globalThis, "fetch", async () => {
      throw error;
    });
    await assert.rejects(getCampaignDetails(7), error);
    mock.restoreAll();
  }
});
