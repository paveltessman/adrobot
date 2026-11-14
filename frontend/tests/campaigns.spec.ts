import { expect, test, type Route } from "@playwright/test";

const api = "**/api/v1/integrations/keitaro/campaigns?*";

async function fulfillPage(
  route: Route,
  items = [{ id: 42, name: "Summer campaign" }],
  hasMore = false,
) {
  const url = new URL(route.request().url());
  await route.fulfill({
    json: {
      data: {
        items,
        limit: Number(url.searchParams.get("limit")),
        offset: Number(url.searchParams.get("offset")),
        has_more: hasMore,
      },
      error: null,
    },
  });
}

test("shows loading, then campaign names and IDs with unavailable actions", async ({
  page,
}, testInfo) => {
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(api, async (route) => {
    await waiting;
    await fulfillPage(route);
  });
  await page.goto("/");
  await expect(page.getByText("Loading campaigns…")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toBeDisabled();
  release();
  await expect(
    page.getByRole("heading", { name: "Summer campaign" }),
  ).toBeVisible();
  await expect(page.getByText("Keitaro ID: 42")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Create campaign" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Open details for Summer campaign" }),
  ).toBeDisabled();
  await expect(page.getByText("Page 1 · Showing 1–1")).toBeVisible();
  await expect(page.getByRole("button", { name: "Previous" })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("campaigns.png"),
    fullPage: true,
  });
});

test("shows an empty state with the creation action", async ({ page }) => {
  await page.route(api, (route) => fulfillPage(route, []));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "No campaigns yet" }),
  ).toBeVisible();
  const buttons = page.getByRole("button", { name: "Create campaign" });
  await expect(buttons).toHaveCount(2);
  await expect(buttons.nth(1)).toBeDisabled();
});

test("retries a failed request", async ({ page }) => {
  let calls = 0;
  await page.route(api, async (route) => {
    if (calls++ === 0)
      await route.fulfill({ status: 502, body: "private upstream details" });
    else await fulfillPage(route);
  });
  await page.goto("/");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Couldn’t load campaigns",
  );
  await expect(page.getByText("private upstream details")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(
    page.getByRole("heading", { name: "Summer campaign" }),
  ).toBeVisible();
  expect(calls).toBe(2);
});

test("paginates forward and back without claiming a total", async ({
  page,
}) => {
  const offsets: number[] = [];
  await page.route(api, async (route) => {
    const offset = Number(
      new URL(route.request().url()).searchParams.get("offset"),
    );
    offsets.push(offset);
    await fulfillPage(
      route,
      [{ id: offset + 1, name: `Campaign at ${offset}` }],
      offset === 0,
    );
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Campaign at 0", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByText("Page 2 · Showing 21–21")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Campaign at 0", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(
    page.getByRole("heading", { name: "Campaign at 0", exact: true }),
  ).toBeVisible();
  expect(offsets).toEqual([0, 20, 0]);
});

test("can return from a later page that became empty", async ({ page }) => {
  await page.route(api, (route) => {
    const offset = Number(
      new URL(route.request().url()).searchParams.get("offset"),
    );
    return fulfillPage(
      route,
      offset === 0 ? [{ id: 1, name: "First campaign" }] : [],
      offset === 0,
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "No campaigns on this page" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(
    page.getByRole("heading", { name: "First campaign" }),
  ).toBeVisible();
});

test("treats malformed data as a load failure", async ({ page }) => {
  await page.route(api, (route) =>
    route.fulfill({ json: { data: { items: null }, error: null } }),
  );
  await page.goto("/");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Couldn’t load campaigns",
  );
  await expect(page.getByRole("button", { name: "Retry" })).toBeEnabled();
});
