import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { getOffer, OfferUnavailableError, searchOffers } from "./offers.ts";

const offer = { id: 9, name: "Summer", state: "active" };
afterEach(() => mock.restoreAll());

test("search encodes queries, avoids caching, and supports cancellation", async () => {
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    Response.json({ data: [offer], error: null }),
  );
  const signal = new AbortController().signal;
  assert.deepEqual(await searchOffers("  Summer & sun  ", signal), [offer]);
  assert.deepEqual(fetchMock.mock.calls[0].arguments, [
    "/api/v1/integrations/keitaro/offers?q=Summer+%26+sun",
    { cache: "no-store", signal },
  ]);
});

test("lookup validates identity and permits disabled offers", async () => {
  const data = { ...offer, state: "disabled" };
  const fetchMock = mock.method(globalThis, "fetch", async () =>
    Response.json({ data, error: null }),
  );
  const signal = new AbortController().signal;
  assert.deepEqual(await getOffer(9, signal), data);
  assert.deepEqual(fetchMock.mock.calls[0].arguments, [
    "/api/v1/integrations/keitaro/offers/9",
    { cache: "no-store", signal },
  ]);
});

test("missing, deleted, and archived offers are unavailable", async () => {
  for (const response of [
    new Response("private", { status: 404 }),
    ...["deleted", "archived"].map((state) =>
      Response.json({ data: { ...offer, state }, error: null }),
    ),
  ]) {
    mock.method(globalThis, "fetch", async () => response);
    await assert.rejects(getOffer(9), OfferUnavailableError);
    mock.restoreAll();
  }
});

test("empty searches work and malformed catalogs are rejected", async () => {
  mock.method(globalThis, "fetch", async () =>
    Response.json({ data: [], error: null }),
  );
  assert.deepEqual(await searchOffers(""), []);
  mock.restoreAll();
  for (const data of [
    null,
    {},
    [offer, offer],
    [{ ...offer, id: 0 }],
    [{ ...offer, name: null }],
    [{ ...offer, state: 1 }],
  ]) {
    mock.method(globalThis, "fetch", async () =>
      Response.json({ data, error: null }),
    );
    await assert.rejects(searchOffers("9"), /invalid response/);
    mock.restoreAll();
  }
});

test("lookup rejects malformed or mismatched data", async () => {
  for (const data of [
    null,
    [],
    {},
    { ...offer, id: 10 },
    { ...offer, id: "9" },
  ]) {
    mock.method(globalThis, "fetch", async () =>
      Response.json({ data, error: null }),
    );
    await assert.rejects(getOffer(9), /invalid response/);
    mock.restoreAll();
  }
});

test("HTTP failures, bad JSON, and error envelopes expose no upstream details", async () => {
  for (const load of [() => searchOffers("sun"), () => getOffer(9)]) {
    for (const status of [401, 403, 422, 500, 502, 504]) {
      mock.method(
        globalThis,
        "fetch",
        async () => new Response("private", { status }),
      );
      await assert.rejects(load(), {
        message: "Unable to load offers. Please try again.",
      });
      mock.restoreAll();
    }
    for (const response of [
      new Response("private"),
      Response.json({ data: offer, error: { message: "private" } }),
      Response.json({ data: offer }),
    ]) {
      mock.method(globalThis, "fetch", async () => response);
      await assert.rejects(load(), /invalid response/);
      mock.restoreAll();
    }
  }
});

test("invalid IDs are rejected before fetching", async () => {
  const fetchMock = mock.method(globalThis, "fetch");
  for (const id of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    await assert.rejects(getOffer(id), RangeError);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("network and abort errors propagate", async () => {
  for (const error of [
    new TypeError("Offline"),
    new DOMException("Aborted", "AbortError"),
  ]) {
    mock.method(globalThis, "fetch", async () => {
      throw error;
    });
    await assert.rejects(searchOffers("sun"), (actual) => actual === error);
    await assert.rejects(getOffer(9), (actual) => actual === error);
    mock.restoreAll();
  }
});
