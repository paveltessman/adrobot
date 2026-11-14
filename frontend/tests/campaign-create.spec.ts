import { expect, test, type Page } from "@playwright/test";

const api = "**/api/v1/integrations/keitaro/";
const postPath = `${api}campaigns`;
const offer = { id: 9, name: "Summer offer", state: "active" };
const campaign = {
  id: 7,
  name: "Summer campaign",
  alias: "example",
  state: "active",
  domain_id: 2,
  group_id: 3,
  traffic_source_id: 4,
  notes: null,
  updated_at: null,
  streams: [],
};

async function setup(page: Page) {
  for (const [resource, id, name] of [
    ["domains", 2, "tracker.example"],
    ["campaign-groups", 3, "Summer group"],
    ["traffic-sources", 4, "Summer source"],
  ] as const)
    await page.route(`${api}${resource}`, (route) =>
      route.fulfill({ json: { data: [{ id, name }], error: null } }),
    );
  await page.route(`${api}offers?*`, (route) =>
    route.fulfill({
      json: {
        data: [offer, { id: 10, name: "Archived", state: "deleted" }],
        error: null,
      },
    }),
  );
  await page.route(`${api}campaigns?*`, (route) =>
    route.fulfill({
      json: {
        data: { items: [], limit: 20, offset: 0, has_more: false },
        error: null,
      },
    }),
  );
  await page.route(`${api}campaigns/7`, (route) =>
    route.fulfill({ json: { data: campaign, error: null } }),
  );
}
async function fillRequired(page: Page) {
  await page
    .getByLabel("Campaign name", { exact: true })
    .fill("Summer campaign");
  await page.getByLabel("Country codes").fill("au");
  await page.getByLabel("Search offers by name or ID").fill("Summer");
  await page
    .getByRole("list", { name: "Offer search results" })
    .getByRole("button", { name: "Select", exact: true })
    .first()
    .click();
}
async function fill(page: Page) {
  await fillRequired(page);
  await page.getByLabel("Domain", { exact: true }).selectOption("2");
  await page.getByLabel("Campaign group", { exact: true }).selectOption("3");
  await page.getByLabel("Traffic source", { exact: true }).selectOption("4");
}
function push(page: Page) {
  return page.getByRole("button", { name: "Push", exact: true });
}

test("opens from the empty list and previews both streams without writing", async ({
  page,
}, testInfo) => {
  await setup(page);
  let writes = 0;
  await page.route(postPath, (route) => {
    writes++;
    return route.fulfill({ status: 500 });
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Create campaign" }).first().click();
  await expect(page).toHaveURL(/\/campaigns\/new$/);
  await expect(push(page)).toBeDisabled();
  await fill(page);
  const preview = page.getByRole("region", {
    name: "Summer campaign",
    exact: true,
  });
  await expect(preview).toContainText("Traffic from AU → Google");
  await expect(preview).toContainText("Offer ID: 9 · Traffic share: 100%");
  await expect(preview).toContainText("tracker.example (ID: 2)");
  await expect(push(page)).toBeEnabled();
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "Archived" })
      .getByRole("button"),
  ).toBeDisabled();
  expect(writes).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("campaign-create.png"),
    fullPage: true,
  });
});

test("Push sends one request, locks controls, and opens confirmed details", async ({
  page,
}) => {
  await setup(page);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let writes = 0;
  await page.route(postPath, async (route) => {
    writes++;
    expect(route.request().postDataJSON()).toEqual({
      name: "Summer campaign",
      country_codes: ["AU"],
      offer_id: 9,
      domain_id: 2,
      group_id: 3,
      traffic_source_id: 4,
    });
    await gate;
    await route.fulfill({
      json: {
        data: { status: "created", campaign_id: 7, campaign },
        error: null,
      },
    });
  });
  await page.goto("/campaigns/new");
  await fill(page);
  await push(page).click();
  await expect(
    page.getByText("Creating campaign…", { exact: true }),
  ).toBeVisible();
  await expect(push(page)).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Campaign name", { exact: true }),
  ).toBeDisabled();
  await page
    .locator("form")
    .evaluate((form: HTMLFormElement) => form.requestSubmit());
  release();
  await expect(page).toHaveURL(/\/campaigns\/7$/);
  await expect(
    page.getByRole("heading", { name: "Summer campaign", exact: true }),
  ).toBeVisible();
  expect(writes).toBe(1);
});

test("Cancel can stay or discard the draft without writing", async ({
  page,
}) => {
  await setup(page);
  let writes = 0;
  await page.route(postPath, (route) => {
    writes++;
    return route.fulfill({ status: 500 });
  });
  await page.goto("/campaigns/new");
  await fill(page);
  page.once("dialog", (dialog) => {
    expect(dialog.message()).toContain("campaign draft");
    return dialog.dismiss();
  });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(/\/campaigns\/new$/);
  await expect(page.getByLabel("Campaign name", { exact: true })).toHaveValue(
    "Summer campaign",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  expect(writes).toBe(0);
});

test("back link and browser back guard pending drafts", async ({ page }) => {
  await setup(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Create campaign" }).first().click();
  await page.getByLabel("Campaign name", { exact: true }).fill("Draft");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("link", { name: "Back to campaigns" }).click();
  await expect(page).toHaveURL(/\/campaigns\/new$/);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.evaluate(() => history.back());
  await expect(page.getByLabel("Campaign name", { exact: true })).toHaveValue(
    "Draft",
  );
});

test("selector failure can retry without losing inputs; empty options allow creation", async ({
  page,
}) => {
  await setup(page);
  let calls = 0;
  await page.route(`${api}domains`, (route) =>
    calls++ === 0
      ? route.fulfill({ status: 502 })
      : route.fulfill({ json: { data: [], error: null } }),
  );
  await page.goto("/campaigns/new");
  await page.getByLabel("Campaign name", { exact: true }).fill("Draft");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Could not load campaign options",
  );
  await page.getByRole("button", { name: "Retry options" }).click();
  await expect(
    page.getByLabel("Domain", { exact: true }).getByRole("option"),
  ).toHaveText(["None"]);
  await expect(page.getByLabel("Campaign name", { exact: true })).toHaveValue(
    "Draft",
  );
  await page.getByLabel("Country codes").fill("AU");
  await page.getByLabel("Search offers by name or ID").fill("Summer");
  await page
    .getByRole("list", { name: "Offer search results" })
    .getByRole("button", { name: "Select", exact: true })
    .first()
    .click();
  await expect(push(page)).toBeEnabled();
});

for (const kind of ["rejected", "failed"] as const) {
  test(`${kind} creation preserves the draft for correction`, async ({
    page,
  }) => {
    await setup(page);
    await page.route(postPath, (route) =>
      kind === "rejected"
        ? route.fulfill({ status: 422, body: "private details" })
        : route.fulfill({
            json: {
              data: { status: "failed", campaign_id: null, campaign: null },
              error: null,
            },
          }),
    );
    await page.goto("/campaigns/new");
    await fill(page);
    await push(page).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "rejected",
    );
    await expect(page.getByRole("main").getByRole("alert")).not.toContainText(
      "private",
    );
    await expect(page.getByLabel("Campaign name", { exact: true })).toHaveValue(
      "Summer campaign",
    );
    await expect(push(page)).toBeEnabled();
    await page.getByLabel("Country codes").fill("1");
    await expect(push(page)).toBeDisabled();
  });
}

for (const kind of [
  "partial",
  "unknown",
  "known-unknown",
  "network",
  "malformed",
  "gateway",
] as const) {
  test(`${kind} creation blocks repeat submissions until explicit review`, async ({
    page,
  }) => {
    await setup(page);
    let writes = 0;
    await page.route(postPath, (route) => {
      writes++;
      if (kind === "network") return route.abort();
      if (kind === "gateway")
        return route.fulfill({ status: 502, body: "private details" });
      if (kind === "malformed")
        return route.fulfill({
          json: {
            data: { status: "created", campaign_id: 7, campaign: null },
            error: null,
          },
        });
      const status = kind === "partial" ? "partial" : "unknown";
      return route.fulfill({
        json: {
          data: {
            status,
            campaign_id: kind === "unknown" ? null : 7,
            campaign: status === "partial" ? campaign : null,
          },
          error: null,
        },
      });
    });
    await page.goto("/campaigns/new");
    await fill(page);
    await push(page).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "draft has been kept",
    );
    await expect(push(page)).toBeDisabled();
    await expect(page.getByLabel("Campaign name", { exact: true })).toHaveValue(
      "Summer campaign",
    );
    if (["partial", "known-unknown", "malformed"].includes(kind))
      await expect(
        page.getByRole("link", { name: "Inspect campaign" }),
      ).toHaveAttribute("href", "/campaigns/7");
    const enable = page.getByRole("button", {
      name: "Enable a new creation attempt",
    });
    await expect(enable).toBeDisabled();
    await page
      .getByLabel("I checked Keitaro and want to make a new creation attempt.")
      .check();
    await enable.click();
    await expect(push(page)).toBeEnabled();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "will create a new campaign",
    );
    expect(writes).toBe(1);
  });
}

test("offer search handles failure and empty results, and clearing selection blocks Push", async ({
  page,
}) => {
  await setup(page);
  let calls = 0;
  await page.route(`${api}offers?*`, (route) => {
    calls++;
    if (calls === 1) return route.fulfill({ status: 502 });
    return route.fulfill({
      json: { data: calls === 2 ? [] : [offer], error: null },
    });
  });
  await page.goto("/campaigns/new");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Could not search offers",
  );
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByText("No offers found.")).toBeVisible();
  await fill(page);
  await expect(push(page)).toBeEnabled();
  await page.getByRole("button", { name: "Clear offer" }).click();
  await expect(push(page)).toBeDisabled();
  await expect(
    page.getByRole("region", { name: "Summer campaign", exact: true }),
  ).toContainText("Select an offer");
});

test("reload warns and discards an unsubmitted draft", async ({ page }) => {
  await setup(page);
  await page.goto("/campaigns/new");
  await page.getByLabel("Campaign name", { exact: true }).fill("Unsaved draft");
  page.once("dialog", (dialog) => {
    expect(dialog.type()).toBe("beforeunload");
    return dialog.accept();
  });
  await page.reload();
  await expect(page.getByLabel("Campaign name", { exact: true })).toHaveValue(
    "",
  );
  await expect(push(page)).toBeDisabled();
});

for (const mode of ["available", "empty", "failed"] as const) {
  test(`creates with multiple countries and no optional selections when options are ${mode}`, async ({
    page,
  }) => {
    await setup(page);
    if (mode !== "available") {
      for (const resource of ["domains", "campaign-groups", "traffic-sources"])
        await page.route(`${api}${resource}`, (route) =>
          mode === "empty"
            ? route.fulfill({ json: { data: [], error: null } })
            : route.fulfill({ status: 502 }),
        );
    }
    let writes = 0;
    await page.route(postPath, (route) => {
      writes++;
      expect(route.request().postDataJSON()).toEqual({
        name: "Summer campaign",
        country_codes: ["AU", "US"],
        offer_id: 9,
        domain_id: null,
        group_id: null,
        traffic_source_id: null,
      });
      return route.fulfill({
        json: {
          data: {
            status: "created",
            campaign_id: 7,
            campaign: {
              ...campaign,
              domain_id: null,
              group_id: 0,
              traffic_source_id: 0,
            },
          },
          error: null,
        },
      });
    });
    await page.goto("/campaigns/new");
    await fillRequired(page);
    await page.getByLabel("Country codes").fill("us, au AU");
    for (const label of ["Domain", "Campaign group", "Traffic source"])
      await expect(page.getByLabel(label, { exact: true })).toHaveValue("");
    const preview = page.getByRole("region", {
      name: "Summer campaign",
      exact: true,
    });
    await expect(preview).toContainText("Traffic from AU, US → Google");
    await expect(preview.getByRole("definition")).toHaveText([
      "None",
      "None",
      "None",
    ]);
    await expect(push(page)).toBeEnabled();
    expect(writes).toBe(0);
    await push(page).click();
    await expect(page).toHaveURL(/\/campaigns\/7$/);
    expect(writes).toBe(1);
  });
}

test("optional selections can be mixed and cleared back to None", async ({
  page,
}) => {
  await setup(page);
  await page.route(postPath, (route) => {
    expect(route.request().postDataJSON()).toEqual({
      name: "Summer campaign",
      country_codes: ["AU"],
      offer_id: 9,
      domain_id: null,
      group_id: 3,
      traffic_source_id: null,
    });
    return route.fulfill({
      json: {
        data: { status: "unknown", campaign_id: null, campaign: null },
        error: null,
      },
    });
  });
  await page.goto("/campaigns/new");
  await fill(page);
  await page.getByLabel("Domain", { exact: true }).selectOption("");
  await page.getByLabel("Traffic source", { exact: true }).selectOption("");
  const preview = page.getByRole("region", {
    name: "Summer campaign",
    exact: true,
  });
  await expect(preview.getByRole("definition")).toHaveText([
    "None",
    "Summer group (ID: 3)",
    "None",
  ]);
  await push(page).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "draft has been kept",
  );
  await expect(page.getByLabel("Domain", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Campaign group", { exact: true })).toHaveValue(
    "3",
  );
  await expect(page.getByLabel("Traffic source", { exact: true })).toHaveValue(
    "",
  );
});

test("empty or malformed country codes block creation and valid lists update the preview", async ({
  page,
}, testInfo) => {
  await setup(page);
  let writes = 0;
  await page.route(postPath, (route) => {
    writes++;
    return route.fulfill({ status: 500 });
  });
  await page.goto("/campaigns/new");
  await fillRequired(page);
  for (const invalid of ["", ", ,", "AU, USA", "AU;US", "AU, 12"]) {
    await page.getByLabel("Country codes").fill(invalid);
    await expect(push(page)).toBeDisabled();
  }
  await page.getByLabel("Country codes").fill("us au, us");
  await expect(push(page)).toBeEnabled();
  await expect(
    page.getByRole("region", { name: "Summer campaign", exact: true }),
  ).toContainText("Traffic from AU, US → Google");
  expect(writes).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("multiple-countries.png"),
    fullPage: true,
  });
});
