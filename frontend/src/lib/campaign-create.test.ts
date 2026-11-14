import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import {
  createCampaign,
  creationRequest,
  creationError,
  getCreationSelectors,
  CreationRejectedError,
  CreationUnknownError,
  type CreationDraft,
} from "./campaign-create.ts";

const draft: CreationDraft = {
  name: " Summer ",
  countryCodes: "au",
  offer: { id: 9, name: "Offer", state: "active" },
  domainId: "2",
  groupId: "3",
  sourceId: "4",
};
const campaign = {
  id: 7,
  name: "Summer",
  alias: "example",
  state: "active",
  domain_id: 2,
  group_id: 3,
  traffic_source_id: 4,
  notes: null,
  updated_at: null,
  streams: [],
};

afterEach(() => mock.restoreAll());

test("normalizes creation inputs and sends only the required fields", () => {
  assert.deepEqual(creationRequest(draft), {
    name: "Summer",
    country_codes: ["AU"],
    offer_id: 9,
    domain_id: 2,
    group_id: 3,
    traffic_source_id: 4,
  });
  assert.equal(creationError(draft), null);
});

for (const update of [
  { name: " " },
  { countryCodes: "A" },
  { countryCodes: "123" },
  { offer: null },
  { offer: { id: 9, name: "Archived", state: "deleted" } },
  { offer: { id: 0, name: "Invalid", state: "active" } },
  { domainId: "0" },
  { groupId: "3.5" },
  { sourceId: "-4" },
  { domainId: "9007199254740992" },
]) {
  test(`invalid draft never writes: ${JSON.stringify(update)}`, async () => {
    const fetchMock = mock.method(globalThis, "fetch");
    assert.ok(creationError({ ...draft, ...update }));
    await assert.rejects(createCampaign({ ...draft, ...update }), RangeError);
    assert.equal(fetchMock.mock.callCount(), 0);
  });
}

test("loads all selector lists through the same origin with cancellation", async () => {
  const options = [{ id: 2, name: "Example" }];
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    Response.json({ data: options, error: null }),
  );
  const signal = new AbortController().signal;
  assert.deepEqual(await getCreationSelectors(signal), {
    domains: options,
    groups: options,
    sources: options,
  });
  assert.deepEqual(
    fetchMock.mock.calls.map((call) => call.arguments),
    ["domains", "campaign-groups", "traffic-sources"].map((resource) => [
      `/api/v1/integrations/keitaro/${resource}`,
      { cache: "no-store", signal },
    ]),
  );
});

test("accepts empty selector lists", async () => {
  mock.method(globalThis, "fetch", async () =>
    Response.json({ data: [], error: null }),
  );
  assert.deepEqual(await getCreationSelectors(), {
    domains: [],
    groups: [],
    sources: [],
  });
});

for (const data of [
  null,
  {},
  [{ id: "1", name: "A" }],
  [{ id: 0, name: "A" }],
  [{ id: 1, name: null }],
  [
    { id: 1, name: "A" },
    { id: 1, name: "B" },
  ],
]) {
  test(`rejects malformed selectors ${JSON.stringify(data)}`, async () => {
    mock.method(globalThis, "fetch", async () =>
      Response.json({ data, error: null }),
    );
    await assert.rejects(getCreationSelectors());
  });
}

test("a single failed selector request fails the load", async () => {
  mock.method(globalThis, "fetch", async (path: string | URL | Request) =>
    String(path).endsWith("/domains")
      ? new Response("private", { status: 502 })
      : Response.json({ data: [], error: null }),
  );
  await assert.rejects(getCreationSelectors(), /Could not load/);
});

test("selector cancellation propagates", async () => {
  const error = new DOMException("Aborted", "AbortError");
  mock.method(globalThis, "fetch", async () => {
    throw error;
  });
  await assert.rejects(getCreationSelectors(), (actual) => actual === error);
});

for (const status of ["created", "partial", "failed", "unknown"] as const) {
  test(`parses ${status} creation result without retrying`, async () => {
    const known = status === "created" || status === "partial";
    const fetchMock = mock.method(globalThis, "fetch", async () =>
      Response.json({
        data: {
          status,
          campaign_id: known ? 7 : null,
          campaign: known ? campaign : null,
        },
        error: null,
      }),
    );
    assert.deepEqual(await createCampaign(draft), {
      status,
      campaignId: known ? 7 : null,
    });
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.deepEqual(fetchMock.mock.calls[0].arguments, [
      "/api/v1/integrations/keitaro/campaigns",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify(creationRequest(draft)),
      },
    ]);
  });
}

test("unknown outcome retains the known campaign identity", async () => {
  mock.method(globalThis, "fetch", async () =>
    Response.json({
      data: { status: "unknown", campaign_id: 7, campaign: null },
      error: null,
    }),
  );
  assert.deepEqual(await createCampaign(draft), {
    status: "unknown",
    campaignId: 7,
  });
});

for (const data of [
  null,
  {},
  { status: "created", campaign_id: 7, campaign: null },
  { status: "created", campaign_id: 7, campaign: { ...campaign, id: 8 } },
  { status: "partial", campaign_id: null, campaign },
  { status: "failed", campaign_id: 7, campaign: null },
  { status: "unknown", campaign_id: -1, campaign: null },
  { status: "unknown", campaign_id: 7, campaign },
  { status: "surprise", campaign_id: 7, campaign: null },
]) {
  test(`malformed creation result is uncertain: ${JSON.stringify(data)}`, async () => {
    mock.method(globalThis, "fetch", async () =>
      Response.json({ data, error: null }),
    );
    await assert.rejects(createCampaign(draft), CreationUnknownError);
  });
}

test("malformed result retains a safe campaign ID for inspection", async () => {
  mock.method(globalThis, "fetch", async () =>
    Response.json({ data: { campaign_id: 7 }, error: null }),
  );
  await assert.rejects(
    createCampaign(draft),
    (error) => error instanceof CreationUnknownError && error.campaignId === 7,
  );
});

for (const status of [422, 500, 502, 504]) {
  test(`HTTP ${status} does not leak upstream details or retry`, async () => {
    const fetchMock = mock.method(
      globalThis,
      "fetch",
      async () => new Response("private tracker details", { status }),
    );
    await assert.rejects(createCampaign(draft), (error) => {
      assert.ok(
        error instanceof
          (status === 422 ? CreationRejectedError : CreationUnknownError),
      );
      assert.ok(!error.message.includes("private"));
      return true;
    });
    assert.equal(fetchMock.mock.callCount(), 1);
  });
}

test("network loss, non-JSON, and error envelopes are uncertain", async () => {
  for (const response of [
    null,
    new Response("invalid"),
    Response.json({ data: campaign, error: { code: "ERROR" } }),
  ]) {
    const fetchMock = mock.method(globalThis, "fetch", async () => {
      if (response === null) throw new TypeError("private network error");
      return response;
    });
    await assert.rejects(createCampaign(draft), CreationUnknownError);
    assert.equal(fetchMock.mock.callCount(), 1);
    mock.restoreAll();
  }
});

for (const countries of ["us, au AU", " AU\tUS\nau ", "au,us", ", au,, US,"]) {
  test(`normalizes several countries: ${JSON.stringify(countries)}`, () => {
    assert.deepEqual(
      creationRequest({ ...draft, countryCodes: countries }).country_codes,
      ["AU", "US"],
    );
  });
}

for (const countries of [
  "",
  " , \t",
  "AU USA",
  "AU;US",
  "AU, 12",
  "AU, U",
  "AU, 日本",
]) {
  test(`rejects an empty or invalid country list: ${JSON.stringify(countries)}`, async () => {
    const fetchMock = mock.method(globalThis, "fetch");
    await assert.rejects(
      createCampaign({ ...draft, countryCodes: countries }),
      RangeError,
    );
    assert.equal(fetchMock.mock.callCount(), 0);
  });
}

for (const mask of [0, 1, 2, 3, 4, 5, 6, 7]) {
  test(`serializes optional selector combination ${mask}`, async () => {
    const values = {
      ...draft,
      countryCodes: "us, au au",
      domainId: mask & 1 ? "2" : "",
      groupId: mask & 2 ? "3" : "",
      sourceId: mask & 4 ? "4" : "",
    };
    const fetchMock = mock.method(globalThis, "fetch", async () =>
      Response.json({
        data: { status: "unknown", campaign_id: null, campaign: null },
        error: null,
      }),
    );
    await createCampaign(values);
    const args = fetchMock.mock.calls[0].arguments as [string, RequestInit];
    assert.deepEqual(JSON.parse(String(args[1].body)), {
      name: "Summer",
      country_codes: ["AU", "US"],
      offer_id: 9,
      domain_id: mask & 1 ? 2 : null,
      group_id: mask & 2 ? 3 : null,
      traffic_source_id: mask & 4 ? 4 : null,
    });
  });
}
