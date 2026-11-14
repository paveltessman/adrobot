import { expect, test } from "@playwright/test";

const api = "**/api/v1/integrations/keitaro/campaigns/7";
const stream = {
  id: 1,
  campaign_id: 7,
  name: "Google",
  type: "regular",
  state: "active",
  position: 1,
  schema: "redirect",
  action_type: "http",
  action_payload: "https://google.com",
  filters: [],
  offers: [],
  offer_details: [],
  removed_offers: [],
};
const campaign = {
  id: 7,
  name: "Summer campaign",
  alias: "summer",
  state: "active",
  domain_id: null,
  group_id: 3,
  traffic_source_id: 4,
  notes: "Campaign notes",
  updated_at: null,
  streams: [
    stream,
    {
      ...stream,
      id: 2,
      name: "Offers",
      schema: "landings",
      action_payload: {},
      offers: [{ offer_id: 9, share: 100, state: "active" }],
      offer_details: [{ id: 9, name: "Summer offer", state: "active" }],
    },
    {
      ...stream,
      id: 3,
      name: "Empty offers",
      schema: "landings",
      action_payload: {},
    },
  ],
};

test("navigates to grouped details and back without writing", async ({
  page,
}, testInfo) => {
  const methods: string[] = [];
  await page.route("**/api/v1/integrations/keitaro/campaigns?*", (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      json: {
        data: {
          items: [{ id: 7, name: campaign.name }],
          limit: Number(url.searchParams.get("limit")),
          offset: 0,
          has_more: false,
        },
        error: null,
      },
    });
  });
  await page.route(api, (route) => {
    methods.push(route.request().method());
    return route.fulfill({ json: { data: campaign, error: null } });
  });
  await page.goto("/");
  await page
    .getByRole("link", { name: "Open details for Summer campaign" })
    .click();
  await expect(page).toHaveURL(/\/campaigns\/7$/);
  await expect(
    page.getByRole("heading", { name: campaign.name }),
  ).toBeVisible();
  await expect(page.getByText("Keitaro ID: 7", { exact: true })).toBeVisible();
  await expect(page.getByText("Campaign notes", { exact: true })).toBeVisible();
  const google = page.getByRole("region", { name: "Google", exact: true });
  await expect(google.getByText("https://google.com")).toBeVisible();
  await expect(
    google.getByText("No offers attached to this stream."),
  ).toBeVisible();
  const offers = page.getByRole("region", { name: "Offers", exact: true });
  await expect(offers.getByText("Summer offer", { exact: true })).toBeVisible();
  await expect(offers.getByText("Offer ID: 9 · Attached")).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Empty offers" })
      .getByText("No offers attached to this stream."),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("details.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: campaign.name }),
  ).toBeVisible();
  expect(methods.every((method) => method === "GET")).toBe(true);
  await page.getByRole("link", { name: "Back to campaigns" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Campaigns", exact: true }),
  ).toBeVisible();
});

test("shows loading and a campaign without streams", async ({ page }) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(api, async (route) => {
    await waiting;
    await route.fulfill({
      json: { data: { ...campaign, streams: [] }, error: null },
    });
  });
  await page.goto("/campaigns/7");
  await expect(page.getByText("Loading campaign…")).toBeVisible();
  release();
  await expect(page.getByText("No streams in this campaign.")).toBeVisible();
});

test("toggles removed offers by stream and reloads history without writing", async ({
  page,
}) => {
  const methods: string[] = [];
  const data = {
    ...campaign,
    streams: campaign.streams.map((item) => ({
      ...item,
      removed_offers:
        item.id === 1
          ? []
          : [
              {
                id: 10,
                name:
                  item.id === 2
                    ? "Former summer offer"
                    : "Former empty-stream offer",
                last_known_state: item.id === 2 ? "active" : "deleted",
              },
            ],
    })),
  };
  await page.route(api, (route) => {
    methods.push(route.request().method());
    return route.fulfill({ json: { data, error: null } });
  });
  await page.goto("/campaigns/7");
  const toggle = page.getByRole("checkbox", { name: "Show removed" });
  const offers = page.getByRole("region", { name: "Offers", exact: true });
  const empty = page.getByRole("region", { name: "Empty offers", exact: true });
  await expect(toggle).not.toBeChecked();
  await expect(
    page.getByText("Former summer offer", { exact: true }),
  ).toHaveCount(0);
  await expect(
    empty.getByText("No offers attached to this stream."),
  ).toBeVisible();
  await toggle.check();
  await expect(
    offers.getByText("Former summer offer", { exact: true }),
  ).toBeVisible();
  await expect(
    empty.getByText("Former empty-stream offer", { exact: true }),
  ).toBeVisible();
  await expect(
    empty.getByText("No offers attached to this stream."),
  ).toHaveCount(0);
  await expect(
    offers.getByText("Former empty-stream offer", { exact: true }),
  ).toHaveCount(0);
  await expect(offers.getByText("Offer ID: 10 · Removed")).toBeVisible();
  await expect(
    empty.getByText(
      "Last known offer status: deleted. Current availability has not been checked.",
    ),
  ).toBeVisible();
  await expect(
    page.getByText("No traffic allocated", { exact: true }),
  ).toHaveCount(2);
  await expect(offers.getByText("Traffic share: 100%")).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Google", exact: true })
      .getByText("https://google.com"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Restore", exact: true }),
  ).toHaveCount(2);
  await toggle.uncheck();
  await expect(page.getByText("Offer ID: 10 · Removed")).toHaveCount(0);
  await expect(empty).toBeVisible();
  await toggle.check();
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(
    offers.getByText("Former summer offer", { exact: true }),
  ).toBeVisible();
  expect(methods).toEqual(["GET", "GET"]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

for (const malformed of [false, true]) {
  test(`retries ${malformed ? "malformed data" : "upstream errors"}`, async ({
    page,
  }) => {
    let calls = 0;
    await page.route(api, (route) => {
      if (calls++ === 0)
        return malformed
          ? route.fulfill({ json: { data: {}, error: null } })
          : route.fulfill({ status: 502, body: "private upstream error" });
      return route.fulfill({ json: { data: campaign, error: null } });
    });
    await page.goto("/campaigns/7");
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Couldn’t load campaign",
    );
    await expect(page.getByText("private upstream error")).toHaveCount(0);
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(
      page.getByRole("heading", { name: campaign.name }),
    ).toBeVisible();
    expect(calls).toBe(2);
  });
}

for (const identifier of ["7", "invalid", "0", "9007199254740992"]) {
  test(`handles unavailable campaign ${identifier}`, async ({ page }) => {
    let calls = 0;
    await page.route("**/api/v1/integrations/keitaro/campaigns/*", (route) => {
      calls++;
      return route.fulfill({ status: 404, body: "private" });
    });
    await page.goto(`/campaigns/${identifier}`);
    await expect(
      page.getByRole("heading", { name: "Campaign not found" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Back to campaigns" }),
    ).toBeVisible();
    expect(calls).toBe(identifier === "7" ? 1 : 0);
  });
}

test("edits stay within their stream and preserve redirect configuration", async ({
  page,
}) => {
  const methods: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/")) methods.push(request.method());
  });
  await page.route(api, (route) =>
    route.fulfill({ json: { data: campaign, error: null } }),
  );
  await page.route("**/api/v1/integrations/keitaro/offers?*", (route) =>
    route.fulfill({
      json: {
        data: [
          { id: 9, name: "Summer offer", state: "active" },
          { id: 10, name: "New offer", state: "active" },
          { id: 11, name: "Third offer", state: "active" },
        ],
        error: null,
      },
    }),
  );
  await page.route("**/api/v1/integrations/keitaro/offers/*", (route) => {
    const id = Number(route.request().url().split("/").pop());
    return route.fulfill({
      json: { data: { id, name: `Offer ${id}`, state: "active" }, error: null },
    });
  });
  await page.goto("/campaigns/7");
  const offers = page.getByRole("region", { name: "Offers", exact: true });
  const members = offers.getByRole("list", {
    name: "Offers in Offers",
    exact: true,
  });
  const results = offers.getByRole("list", { name: "Offer search results" });
  await offers.getByLabel("Search offers by name or ID").fill("offer");
  await offers.getByRole("button", { name: "Search", exact: true }).click();
  await expect(
    results.getByRole("button", { name: "Already attached" }),
  ).toBeDisabled();
  await results
    .getByRole("listitem")
    .filter({ hasText: "New offer" })
    .getByRole("button", { name: "Add", exact: true })
    .click();
  await expect(
    members.getByText("Offer ID: 10 · Pending addition"),
  ).toBeVisible();
  await expect(
    members.getByText("Traffic share: 50%", { exact: true }),
  ).toHaveCount(2);
  const original = members
    .getByRole("listitem")
    .filter({ hasText: "Offer ID: 9 ·" });
  await original.getByRole("button", { name: "Pin", exact: true }).click();
  await results
    .getByRole("listitem")
    .filter({ hasText: "Third offer" })
    .getByRole("button", { name: "Add", exact: true })
    .click();
  await expect(original.getByText("Traffic share: 50% · Pinned")).toBeVisible();
  await expect(
    members.getByText("Traffic share: 25%", { exact: true }),
  ).toHaveCount(2);
  await original.getByRole("button", { name: "Unpin", exact: true }).click();
  await expect(
    original.getByText("Traffic share: 33%", { exact: true }),
  ).toBeVisible();
  await original.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(
    original.getByText("Offer ID: 9 · Pending removal"),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "Show removed" }),
  ).not.toBeChecked();
  await original.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(original.getByText("Offer ID: 9 · Attached")).toBeVisible();
  await expect(
    original.getByRole("button", { name: "Pin", exact: true }),
  ).toBeEnabled();
  await expect(members.getByRole("listitem")).toHaveCount(3);
  const empty = page.getByRole("region", { name: "Empty offers", exact: true });
  await expect(
    empty.getByText("No offers attached to this stream."),
  ).toBeVisible();
  const google = page.getByRole("region", { name: "Google", exact: true });
  await expect(google.getByRole("button")).toHaveCount(0);
  await expect(google.getByRole("textbox")).toHaveCount(0);
  await expect(google.getByText("https://google.com")).toBeVisible();
  expect(methods.every((method) => method === "GET")).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("search loading, failure, empty results, and adding to an empty stream", async ({
  page,
}) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route(api, (route) =>
    route.fulfill({ json: { data: campaign, error: null } }),
  );
  await page.route("**/api/v1/integrations/keitaro/offers?*", async (route) => {
    const call = calls++;
    if (call === 0) {
      await waiting;
      await route.fulfill({ status: 502, body: "private" });
    } else
      await route.fulfill({
        json: {
          data: call === 1 ? [] : [{ id: 10, name: "Found", state: "active" }],
          error: null,
        },
      });
  });
  await page.route("**/api/v1/integrations/keitaro/offers/10", (route) =>
    route.fulfill({
      json: { data: { id: 10, name: "Found", state: "active" }, error: null },
    }),
  );
  await page.goto("/campaigns/7");
  const empty = page.getByRole("region", { name: "Empty offers", exact: true });
  const search = empty.getByRole("button", { name: "Search", exact: true });
  await empty.getByLabel("Search offers by name or ID").fill("10");
  await search.click();
  await expect(empty.getByRole("status")).toHaveText("Searching offers…");
  release();
  await expect(empty.getByRole("alert")).toHaveText(
    "Could not search offers. Please try again.",
  );
  await search.click();
  await expect(empty.getByRole("status")).toHaveText("No matching offers.");
  await search.click();
  await empty.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    empty.getByText("Offer ID: 10 · Pending addition"),
  ).toBeVisible();
  await expect(empty.getByText("Traffic share: 100%")).toBeVisible();
  await empty.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(empty.getByRole("alert")).toHaveText(
    "A stream must have at least one offer.",
  );
  await expect(
    page
      .getByRole("region", { name: "Offers", exact: true })
      .getByText("Traffic share: 100%"),
  ).toBeVisible();
});

for (const state of ["missing", "deleted", "archived", "active"]) {
  test(`checks availability before historical restoration: ${state}`, async ({
    page,
  }) => {
    const data = {
      ...campaign,
      streams: campaign.streams.map((item) =>
        item.id === 2
          ? {
              ...item,
              removed_offers: [
                { id: 10, name: "Former offer", last_known_state: "deleted" },
              ],
            }
          : item,
      ),
    };
    await page.route(api, (route) =>
      route.fulfill({ json: { data, error: null } }),
    );
    await page.route("**/api/v1/integrations/keitaro/offers/10", (route) =>
      state === "missing"
        ? route.fulfill({ status: 404, body: "private" })
        : route.fulfill({
            json: {
              data: { id: 10, name: "Current name", state },
              error: null,
            },
          }),
    );
    await page.goto("/campaigns/7");
    await page.getByRole("checkbox", { name: "Show removed" }).check();
    const offers = page.getByRole("region", { name: "Offers", exact: true });
    await offers.getByRole("button", { name: "Restore", exact: true }).click();
    if (state === "active") {
      await expect(
        offers.getByText("Offer ID: 10 · Pending addition"),
      ).toBeVisible();
      await expect(
        offers.getByText("Current name", { exact: true }),
      ).toBeVisible();
      await expect(
        offers.getByText("Traffic share: 50%", { exact: true }),
      ).toHaveCount(2);
    } else {
      await expect(
        offers.getByRole("button", { name: "Restore", exact: true }),
      ).toBeDisabled();
      await expect(offers.getByRole("alert")).toContainText(
        state === "missing" ? "no longer available" : "archived or deleted",
      );
      await expect(offers.getByText("Offer ID: 10 · Removed")).toBeVisible();
      await expect(offers.getByText("Traffic share: 100%")).toBeVisible();
    }
  });
}

test("availability failure preserves pins and permits retry", async ({
  page,
}) => {
  let calls = 0;
  await page.route(api, (route) =>
    route.fulfill({ json: { data: campaign, error: null } }),
  );
  await page.route("**/api/v1/integrations/keitaro/offers?*", (route) =>
    route.fulfill({
      json: { data: [{ id: 10, name: "New", state: "active" }], error: null },
    }),
  );
  await page.route("**/api/v1/integrations/keitaro/offers/10", (route) =>
    calls++ === 0
      ? route.fulfill({ status: 502, body: "private" })
      : route.fulfill({
          json: { data: { id: 10, name: "New", state: "active" }, error: null },
        }),
  );
  await page.goto("/campaigns/7");
  const offers = page.getByRole("region", { name: "Offers", exact: true });
  await offers.getByRole("button", { name: "Pin", exact: true }).click();
  await offers.getByRole("button", { name: "Search", exact: true }).click();
  await offers.getByRole("button", { name: "Add", exact: true }).click();
  await expect(offers.getByRole("alert")).toHaveText(
    "Could not check offer availability. Please try again.",
  );
  await expect(offers.getByText("Traffic share: 100% · Pinned")).toBeVisible();
  await offers.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    offers.getByText("Offer ID: 10 · Pending addition"),
  ).toBeVisible();
  await expect(offers.getByText("Traffic share: 0%")).toBeVisible();
  await expect(offers.getByText("Traffic share: 100% · Pinned")).toBeVisible();
});
