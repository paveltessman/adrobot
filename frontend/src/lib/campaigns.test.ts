import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

import { getCampaigns } from "./campaigns.ts";

afterEach(() => mock.restoreAll());

function page(items: unknown[] = [], limit = 100, offset = 0) {
  return { items, limit, offset, has_more: false };
}

test("loads campaigns through the same origin without caching", async () => {
  const data = page([{ id: 42, name: "Campaign" }], 20, 40);
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    Response.json({ data, error: null }),
  );
  const signal = new AbortController().signal;

  assert.deepEqual(await getCampaigns({ limit: 20, offset: 40, signal }), data);
  assert.deepEqual(fetchMock.mock.calls[0].arguments, [
    "/api/v1/integrations/keitaro/campaigns?limit=20&offset=40",
    { cache: "no-store", signal },
  ]);
});

test("accepts an empty page with default pagination", async () => {
  mock.method(globalThis, "fetch", async () =>
    Response.json({ data: page(), error: null }),
  );
  assert.deepEqual(await getCampaigns(), page());
});

test("preserves has_more for pagination", async () => {
  const data = { ...page([{ id: 1, name: "First" }], 1), has_more: true };
  mock.method(globalThis, "fetch", async () =>
    Response.json({ data, error: null }),
  );
  assert.deepEqual(await getCampaigns({ limit: 1 }), data);
});

for (const status of [422, 500, 502, 504]) {
  test(`handles HTTP ${status} without exposing response details`, async () => {
    mock.method(
      globalThis,
      "fetch",
      async () => new Response("private upstream details", { status }),
    );
    await assert.rejects(getCampaigns(), {
      message: "Unable to load campaigns. Please try again.",
    });
  });
}

for (const data of [
  null,
  {},
  page([{ id: "1", name: "Invalid ID" }]),
  page([{ id: 1, name: null }]),
  { ...page(), has_more: "yes" },
  { ...page(), items: null },
  page([], 20),
  page([], 100, 20),
  page([{}, {}], 1),
]) {
  test(`rejects malformed or mismatched data: ${JSON.stringify(data)}`, async () => {
    mock.method(globalThis, "fetch", async () =>
      Response.json({ data, error: null }),
    );
    await assert.rejects(getCampaigns(), /invalid response/);
  });
}

test("rejects an error envelope even with HTTP 200", async () => {
  mock.method(globalThis, "fetch", async () =>
    Response.json({ data: null, error: { code: "UPSTREAM_ERROR" } }),
  );
  await assert.rejects(getCampaigns(), /invalid response/);
});

test("rejects non-JSON responses", async () => {
  mock.method(
    globalThis,
    "fetch",
    async () => new Response("<html>error</html>"),
  );
  await assert.rejects(getCampaigns(), /invalid response/);
});

test("propagates network failures and cancellation", async () => {
  for (const error of [
    new TypeError("Network unavailable"),
    new DOMException("Aborted", "AbortError"),
  ]) {
    mock.method(globalThis, "fetch", async () => {
      throw error;
    });
    await assert.rejects(getCampaigns(), (actual) => actual === error);
    mock.restoreAll();
  }
});

test("rejects invalid pagination before making a request", async () => {
  const fetchMock = mock.method(globalThis, "fetch");
  for (const options of [
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { offset: -1 },
    { offset: 0.5 },
    { offset: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    await assert.rejects(getCampaigns(options), RangeError);
  }
  assert.equal(fetchMock.mock.callCount(), 0);
});
