import { expect, test } from "@playwright/test";

const api = "**/api/v1/integrations/keitaro/";
const offer = { id: 9, name: "Current offer", state: "active" };

for (const flow of ["creation", "editor"] as const) {
  test(`${flow} offer search clears after manual search, ignores stale results, and retries`, async ({
    page,
  }) => {
    for (const resource of ["domains", "campaign-groups", "traffic-sources"])
      await page.route(`${api}${resource}`, (route) =>
        route.fulfill({ json: { data: [], error: null } }),
      );
    await page.route(`${api}campaigns/7`, (route) =>
      route.fulfill({
        json: {
          data: {
            id: 7,
            name: "Campaign",
            alias: null,
            state: "active",
            domain_id: null,
            group_id: null,
            traffic_source_id: null,
            notes: null,
            updated_at: null,
            streams: [
              {
                id: 1,
                campaign_id: 7,
                name: "Offers",
                type: "regular",
                state: "active",
                position: 1,
                schema: "landings",
                action_type: "http",
                action_payload: null,
                filters: [],
                offers: [],
                offer_details: [],
                removed_offers: [],
                pinned_offer_ids: [],
              },
            ],
          },
          error: null,
        },
      }),
    );
    let release!: () => void;
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    let delayedCompleted!: () => void;
    const completed = new Promise<void>((resolve) => {
      delayedCompleted = resolve;
    });
    const queries: string[] = [];
    let fail = true;
    await page.route(`${api}offers?*`, async (route) => {
      const query = new URL(route.request().url()).searchParams.get("q")!;
      queries.push(query);
      if (query === "stale") {
        await delayed;
        await route.fulfill({
          json: { data: [{ ...offer, name: "Stale offer" }], error: null },
        });
        delayedCompleted();
      } else if (query === "retry" && fail) {
        fail = false;
        await route.fulfill({ status: 502 });
      } else {
        await route.fulfill({ json: { data: [offer], error: null } });
      }
    });
    await page.goto(flow === "creation" ? "/campaigns/new" : "/campaigns/7");
    const input = page.getByLabel("Search offers by name or ID");
    const search = page.getByRole("button", { name: "Search", exact: true });
    const results = page.getByRole("list", { name: "Offer search results" });

    await input.fill("stale");
    await expect.poll(() => queries).toContain("stale");
    await input.fill("current");
    await expect(results).toContainText("Current offer");
    release();
    await completed;
    await expect(results).toContainText("Current offer");
    await expect(results).not.toContainText("Stale offer");

    await search.click();
    await expect(results).toBeVisible();
    await input.fill("");
    await expect(results).toHaveCount(0);
    // Wait beyond the debounce to prove clearing does not fetch the catalog.
    await page.waitForTimeout(400);
    expect(queries).not.toContain("");
    await search.click();
    await expect.poll(() => queries).toContain("");
    await expect(results).toContainText("Current offer");

    await input.fill("retry");
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "Could not search offers",
    );
    await search.click();
    await expect(results).toContainText("Current offer");
    expect(queries.filter((query) => query === "retry")).toHaveLength(2);
  });
}
