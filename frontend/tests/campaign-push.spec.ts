import { expect, test, type Page } from "@playwright/test";
import type {
  CampaignDetails,
  CampaignStream,
} from "../src/lib/campaign-details";
import type { StreamChange } from "../src/lib/campaign-push";

const detailsPath = "**/api/v1/integrations/keitaro/campaigns/7";
const pushPath = `${detailsPath}/push`;
function offerStream(
  id: number,
  offerId: number,
  name: string,
): CampaignStream {
  return {
    id,
    campaign_id: 7,
    name,
    type: "regular",
    state: "active",
    position: id,
    schema: "landings",
    action_type: "http",
    action_payload: {},
    filters: [],
    offers: [{ offer_id: offerId, share: 100, state: "disabled" }],
    offer_details: [{ id: offerId, name: `Offer ${offerId}`, state: "active" }],
    removed_offers: [
      { id: 10, name: "Restorable offer", last_known_state: "active" },
    ],
    pinned_offer_ids: [],
  };
}
const campaign: CampaignDetails = {
  id: 7,
  name: "Push campaign",
  alias: null,
  state: "active",
  domain_id: null,
  group_id: null,
  traffic_source_id: null,
  notes: null,
  updated_at: null,
  streams: [
    {
      ...offerStream(1, 9, "Google"),
      schema: "redirect",
      action_payload: "https://google.com",
      offers: [],
      offer_details: [],
      removed_offers: [],
    },
    offerStream(2, 9, "Offers"),
    offerStream(3, 11, "Secondary"),
  ],
};
function applied(
  current: CampaignDetails,
  changes: StreamChange[],
): CampaignDetails {
  return {
    ...current,
    streams: current.streams.map((stream) => {
      const change = changes.find((item) => item.stream_id === stream.id);
      if (!change) return stream;
      return {
        ...stream,
        offers: change.offers,
        pinned_offer_ids: change.pinned_offer_ids,
        offer_details: change.offers.map((offer) => ({
          id: offer.offer_id,
          name: `Offer ${offer.offer_id}`,
          state: "active",
        })),
        removed_offers: stream.offers
          .filter(
            (offer) =>
              !change.offers.some((item) => item.offer_id === offer.offer_id),
          )
          .map((offer) => ({
            id: offer.offer_id,
            name: `Offer ${offer.offer_id}`,
            last_known_state: "active",
          })),
      };
    }),
  };
}
async function setup(page: Page) {
  await page.route(detailsPath, (route) =>
    route.fulfill({ json: { data: campaign, error: null } }),
  );
  await page.route("**/api/v1/integrations/keitaro/offers?*", (route) =>
    route.fulfill({
      json: {
        data: [{ id: 10, name: "Restorable offer", state: "active" }],
        error: null,
      },
    }),
  );
  await page.route("**/api/v1/integrations/keitaro/offers/10", (route) =>
    route.fulfill({
      json: {
        data: { id: 10, name: "Restorable offer", state: "active" },
        error: null,
      },
    }),
  );
  await page.goto("/campaigns/7");
  await expect(
    page.getByRole("heading", { name: "Push campaign" }),
  ).toBeVisible();
}
async function add(page: Page, name = "Offers") {
  const region = page.getByRole("region", { name, exact: true });
  await region.getByRole("button", { name: "Search", exact: true }).click();
  await region.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    region.getByText("Offer ID: 10 · Pending addition"),
  ).toBeVisible();
}
const summary = (page: Page) =>
  page.getByRole("complementary", { name: "Pending changes" });
const push = (page: Page) =>
  summary(page).getByRole("button", { name: "Push", exact: true });

test("Push saves a restoration and pins, reloads confirmed state, and removes navigation warnings", async ({
  page,
}) => {
  let saved = campaign;
  const posts: StreamChange[][] = [];
  await setup(page);
  await page.route(detailsPath, (route) =>
    route.fulfill({ json: { data: saved, error: null } }),
  );
  await page.route(pushPath, async (route) => {
    const body = route.request().postDataJSON() as { streams: StreamChange[] };
    expect(route.request().method()).toBe("POST");
    posts.push(body.streams);
    saved = applied(saved, body.streams);
    await route.fulfill({
      json: {
        data: {
          status: "applied",
          campaign: saved,
          pending_streams: [],
          message: null,
        },
        error: null,
      },
    });
  });
  await page.getByLabel("Show removed").check();
  const region = page.getByRole("region", { name: "Offers", exact: true });
  await region.getByRole("button", { name: "Restore", exact: true }).click();
  const original = region
    .getByRole("listitem")
    .filter({ hasText: "Offer ID: 9 ·" });
  await original.getByRole("button", { name: "Pin", exact: true }).click();
  await expect(push(page)).toBeEnabled();
  await push(page).click();
  await expect(page.getByRole("status")).toContainText(
    "Changes saved successfully.",
  );
  await expect(summary(page)).toHaveCount(0);
  expect(posts).toEqual([
    [
      {
        stream_id: 2,
        offers: [
          { offer_id: 9, share: 50, state: "disabled" },
          { offer_id: 10, share: 50, state: "active" },
        ],
        pinned_offer_ids: [9],
      },
    ],
  ]);
  await expect(original.getByText("Traffic share: 50% · Pinned")).toBeVisible();
  await expect(region.getByText("Offer ID: 10 · Attached")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Google", exact: true }),
  ).toContainText("https://google.com");
  page.on("dialog", () => {
    throw new Error("Unexpected warning after saved Push");
  });
  await page.reload();
  await expect(original.getByText("Traffic share: 50% · Pinned")).toBeVisible();
  expect(posts).toHaveLength(1);
});

test("saving disables duplicate submission, editing, and Cancel", async ({
  page,
}) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await setup(page);
  await page.route(pushPath, async (route) => {
    calls += 1;
    const body = route.request().postDataJSON() as { streams: StreamChange[] };
    await gate;
    await route.fulfill({
      json: {
        data: {
          status: "applied",
          campaign: applied(campaign, body.streams),
          pending_streams: [],
        },
        error: null,
      },
    });
  });
  const region = page.getByRole("region", { name: "Offers", exact: true });
  await region.getByRole("button", { name: "Pin", exact: true }).click();
  await push(page).click();
  await expect(
    page.getByText("Saving changes…", { exact: true }),
  ).toBeVisible();
  const saving = summary(page).getByRole("button", {
    name: "Saving…",
    exact: true,
  });
  await expect(saving).toBeDisabled();
  await expect(
    summary(page).getByRole("button", { name: "Cancel", exact: true }),
  ).toBeDisabled();
  await expect(
    region.getByRole("button", { name: "Remove", exact: true }),
  ).toBeDisabled();
  await expect(region.getByLabel("Search offers by name or ID")).toBeDisabled();
  await saving.dispatchEvent("click");
  expect(calls).toBe(1);
  release();
  await expect(summary(page)).toHaveCount(0);
});

test("invalid removal disables Push and Cancel restores the confirmed state without POST", async ({
  page,
}) => {
  let calls = 0;
  await setup(page);
  await page.route(pushPath, (route) => {
    calls += 1;
    return route.abort();
  });
  const region = page.getByRole("region", { name: "Offers", exact: true });
  await region.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(push(page)).toBeDisabled();
  await expect(summary(page)).toContainText("at least one offer");
  await summary(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(summary(page)).toHaveCount(0);
  await expect(
    region.getByText("Traffic share: 100%", { exact: true }),
  ).toBeVisible();
  expect(calls).toBe(0);
});

test("partial completion keeps only remaining changes and a retry sends only that stream", async ({
  page,
}) => {
  const posts: StreamChange[][] = [];
  let saved = campaign;
  await setup(page);
  await page.route(pushPath, async (route) => {
    const { streams } = route.request().postDataJSON() as {
      streams: StreamChange[];
    };
    posts.push(streams);
    saved = applied(saved, posts.length === 1 ? [streams[0]] : streams);
    await route.fulfill({
      json: {
        data: {
          status: posts.length === 1 ? "partial" : "applied",
          campaign: saved,
          pending_streams: posts.length === 1 ? [streams[1]] : [],
        },
        error: null,
      },
    });
  });
  await add(page);
  await add(page, "Secondary");
  await push(page).click();
  await expect(
    page.getByRole("alert", { name: "Campaign synchronization" }),
  ).toContainText("Some changes were saved");
  await expect(
    summary(page).getByRole("region", {
      name: "Changes in Offers",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    summary(page).getByRole("region", {
      name: "Changes in Secondary",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Offers", exact: true })
      .getByText("Offer ID: 10 · Attached"),
  ).toBeVisible();
  await push(page).click();
  await expect(summary(page)).toHaveCount(0);
  expect(
    posts.map((streams) => streams.map((stream) => stream.stream_id)),
  ).toEqual([[2, 3], [3]]);
});

for (const kind of ["failed", "rejected"] as const) {
  test(`${kind} Push preserves the draft and allows correction, retry, or Cancel`, async ({
    page,
  }) => {
    await setup(page);
    await page.route(pushPath, (route) =>
      kind === "rejected"
        ? route.fulfill({ status: 422, body: "private validation details" })
        : route.fulfill({
            json: {
              data: {
                status: "failed",
                campaign,
                pending_streams: (
                  route.request().postDataJSON() as { streams: StreamChange[] }
                ).streams,
              },
              error: null,
            },
          }),
    );
    await add(page);
    await push(page).click();
    await expect(
      page.getByRole("alert", { name: "Campaign synchronization" }),
    ).toContainText(
      kind === "failed" ? "draft has been kept" : "Push was rejected",
    );
    await expect(
      page.getByRole("alert", { name: "Campaign synchronization" }),
    ).not.toContainText("private");
    await expect(push(page)).toBeEnabled();
    const region = page.getByRole("region", { name: "Offers", exact: true });
    await expect(
      region.getByText("Offer ID: 10 · Pending addition"),
    ).toBeVisible();
    await summary(page)
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(summary(page)).toHaveCount(0);
    await expect(
      region.getByText("Traffic share: 100%", { exact: true }),
    ).toBeVisible();
  });
}

for (const kind of ["unknown", "network", "malformed", "gateway"] as const) {
  test(`${kind} outcome keeps the draft and requires a read-only state check before retry`, async ({
    page,
  }) => {
    await setup(page);
    let posts = 0;
    let saved = campaign;
    let checks = 0;
    await page.route(detailsPath, (route) => {
      checks += 1;
      return checks === 1
        ? route.fulfill({ status: 502, body: "private" })
        : route.fulfill({ json: { data: saved, error: null } });
    });
    await page.route(pushPath, async (route) => {
      posts += 1;
      const { streams } = route.request().postDataJSON() as {
        streams: StreamChange[];
      };
      saved = applied(campaign, streams);
      if (kind === "network") return route.abort();
      if (kind === "malformed")
        return route.fulfill({
          json: {
            data: { status: "applied", campaign: null, pending_streams: [] },
            error: null,
          },
        });
      if (kind === "gateway")
        return route.fulfill({ status: 502, body: "private" });
      return route.fulfill({
        json: {
          data: { status: "unknown", campaign: null, pending_streams: streams },
          error: null,
        },
      });
    });
    await add(page);
    await push(page).click();
    await expect(
      page.getByRole("alert", { name: "Campaign synchronization" }),
    ).toContainText("draft has been kept");
    await expect(push(page)).toBeDisabled();
    await expect(
      summary(page).getByRole("button", { name: "Cancel", exact: true }),
    ).toBeDisabled();
    const check = page.getByRole("button", {
      name: "Check saved state",
      exact: true,
    });
    await check.click();
    await expect(
      page.getByRole("alert", { name: "Campaign synchronization" }),
    ).toContainText("Could not check saved state");
    await expect(summary(page)).toBeVisible();
    await check.click();
    await expect(summary(page)).toHaveCount(0);
    await expect(page.getByRole("status")).toContainText(
      "No pending changes remain",
    );
    expect(posts).toBe(1);
    expect(checks).toBe(2);
  });
}

test("unknown outcome recovery keeps uncommitted pins and Cancel uses refreshed allocations", async ({
  page,
}) => {
  await setup(page);
  let saved = campaign;
  let calls = 0;
  await page.route(detailsPath, (route) =>
    route.fulfill({ json: { data: saved, error: null } }),
  );
  await page.route(pushPath, (route) => {
    calls += 1;
    const { streams } = route.request().postDataJSON() as {
      streams: StreamChange[];
    };
    saved = applied(
      campaign,
      streams.map((change) => ({ ...change, pinned_offer_ids: [] })),
    );
    return route.fulfill({
      json: {
        data: { status: "unknown", campaign: null, pending_streams: streams },
        error: null,
      },
    });
  });
  await add(page);
  const region = page.getByRole("region", { name: "Offers", exact: true });
  await region
    .getByRole("listitem")
    .filter({ hasText: "Offer ID: 9 ·" })
    .getByRole("button", { name: "Pin", exact: true })
    .click();
  await push(page).click();
  await page
    .getByRole("button", { name: "Check saved state", exact: true })
    .click();
  await expect(summary(page)).toContainText("Traffic: 50% → 50% · Pin");
  await expect(summary(page)).not.toContainText("Restore");
  await expect(push(page)).toBeEnabled();
  await summary(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(summary(page)).toHaveCount(0);
  await expect(region.getByText("Offer ID: 10 · Attached")).toBeVisible();
  await expect(
    region.getByText("Traffic share: 50%", { exact: true }),
  ).toHaveCount(2);
  expect(calls).toBe(1);
});

test("a lookup started before Push cannot append an offer after the saved result", async ({
  page,
}) => {
  await setup(page);
  let release = () => {};
  let finished = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const completed = new Promise<void>((resolve) => {
    finished = resolve;
  });
  await page.route(
    "**/api/v1/integrations/keitaro/offers/10",
    async (route) => {
      await gate;
      await route.fulfill({
        json: { data: { id: 10, name: "Late", state: "active" }, error: null },
      });
      finished();
    },
  );
  await page.route(pushPath, (route) => {
    const { streams } = route.request().postDataJSON() as {
      streams: StreamChange[];
    };
    return route.fulfill({
      json: {
        data: {
          status: "applied",
          campaign: applied(campaign, streams),
          pending_streams: [],
        },
        error: null,
      },
    });
  });
  const region = page.getByRole("region", { name: "Offers", exact: true });
  await region.getByRole("button", { name: "Pin", exact: true }).click();
  await region.getByRole("button", { name: "Search", exact: true }).click();
  await region.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    region.getByRole("button", { name: "Checking…", exact: true }),
  ).toBeVisible();
  await push(page).click();
  await expect(summary(page)).toHaveCount(0);
  release();
  await completed;
  await expect(region.getByText("Offer ID: 10 · Pending addition")).toHaveCount(
    0,
  );
  await expect(summary(page)).toHaveCount(0);
  await expect(region.getByText("Traffic share: 100% · Pinned")).toBeVisible();
});

test("a disappeared stream retains a blocked summary that Cancel can discard", async ({
  page,
}) => {
  await setup(page);
  await page.route(pushPath, (route) =>
    route.fulfill({
      json: {
        data: {
          status: "partial",
          campaign: {
            ...campaign,
            streams: campaign.streams.filter((stream) => stream.id !== 2),
          },
          pending_streams: (
            route.request().postDataJSON() as { streams: StreamChange[] }
          ).streams,
        },
        error: null,
      },
    }),
  );
  await page
    .getByRole("region", { name: "Offers", exact: true })
    .getByRole("button", { name: "Pin", exact: true })
    .click();
  await push(page).click();
  await expect(summary(page)).toContainText(
    "This stream is no longer available for offer editing",
  );
  await expect(push(page)).toBeDisabled();
  await expect(
    page.getByRole("region", { name: "Offers", exact: true }),
  ).toHaveCount(0);
  await summary(page)
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await expect(summary(page)).toHaveCount(0);
});

test("successful removal disappears until Show removed is enabled", async ({
  page,
}) => {
  await setup(page);
  await page.route(pushPath, (route) => {
    const { streams } = route.request().postDataJSON() as {
      streams: StreamChange[];
    };
    expect(streams[0].offers).toEqual([
      { offer_id: 10, share: 100, state: "active" },
    ]);
    return route.fulfill({
      json: {
        data: {
          status: "applied",
          campaign: applied(campaign, streams),
          pending_streams: [],
        },
        error: null,
      },
    });
  });
  await add(page);
  const region = page.getByRole("region", { name: "Offers", exact: true });
  await region
    .getByRole("listitem")
    .filter({ hasText: "Offer ID: 9 ·" })
    .getByRole("button", { name: "Remove", exact: true })
    .click();
  await expect(region.getByText("Offer ID: 9 · Pending removal")).toBeVisible();
  await push(page).click();
  await expect(summary(page)).toHaveCount(0);
  await expect(region.getByText("Offer ID: 9 ·", { exact: false })).toHaveCount(
    0,
  );
  await page.getByLabel("Show removed").check();
  await expect(region.getByText("Offer ID: 9 · Removed")).toBeVisible();
});
