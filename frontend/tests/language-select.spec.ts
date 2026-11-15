import { expect, test, type Page } from "@playwright/test";
import type { CampaignDetails } from "../src/lib/campaign-details";

const api = "**/api/v1/integrations/keitaro/";
const campaign: CampaignDetails = {
  id: 7,
  name: "Summer campaign",
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
      name: "Google",
      type: "regular",
      state: "active",
      position: 1,
      schema: "redirect",
      action_type: "http",
      action_payload: "https://google.com",
      filters: [{ name: "country", mode: "accept", payload: ["RU"] }],
      offers: [],
      offer_details: [],
      removed_offers: [],
      pinned_offer_ids: [],
    },
    {
      id: 2,
      campaign_id: 7,
      name: "Offers",
      type: "regular",
      state: "active",
      position: 2,
      schema: "landings",
      action_type: "http",
      action_payload: {},
      filters: [],
      offers: [{ offer_id: 9, share: 100, state: "active" }],
      offer_details: [{ id: 9, name: "Summer offer", state: "active" }],
      removed_offers: [
        { id: 10, name: "Former offer", last_known_state: "active" },
      ],
      pinned_offer_ids: [],
    },
  ],
};

async function setup(page: Page) {
  await page.route(`${api}campaigns?*`, (route) =>
    route.fulfill({
      json: {
        data: {
          items: [{ id: 7, name: campaign.name }],
          limit: 20,
          offset: 0,
          has_more: false,
        },
        error: null,
      },
    }),
  );
  await page.route(`${api}campaigns/7`, (route) =>
    route.fulfill({ json: { data: campaign, error: null } }),
  );
  for (const resource of ["domains", "campaign-groups", "traffic-sources"]) {
    await page.route(`${api}${resource}`, (route) =>
      route.fulfill({
        json: { data: [{ id: 2, name: "Resource name" }], error: null },
      }),
    );
  }
  await page.route(`${api}offers?*`, (route) =>
    route.fulfill({
      json: {
        data: [{ id: 9, name: "Summer offer", state: "active" }],
        error: null,
      },
    }),
  );
  await page.route(`${api}offers/10`, (route) =>
    route.fulfill({ status: 404 }),
  );
}

async function expectMetadata(page: Page, locale: "en" | "ru") {
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page).toHaveTitle(
    locale === "ru"
      ? "Adrobot | Управление кампаниями"
      : "Adrobot | Campaign management",
  );
  await expect(page.locator("head title")).toHaveCount(1);
  await expect(page.locator('head meta[name="description"]')).toHaveCount(1);
  await expect(page.locator('head meta[name="description"]')).toHaveAttribute(
    "content",
    locale === "ru"
      ? "Создавайте рекламные кампании Keitaro и управляйте ими с помощью Adrobot."
      : "Create and manage Keitaro advertising campaigns with Adrobot.",
  );
}
async function switchTo(page: Page, locale: "en" | "ru") {
  await page
    .getByRole("combobox", { name: /^(Language|Язык)$/ })
    .selectOption(locale);
  await expectMetadata(page, locale);
}

test.beforeEach(async ({ page }) => {
  await setup(page);
});

test("switches instantly, persists across navigation and reload, and updates metadata", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expectMetadata(page, "en");
  const language = page.getByRole("combobox", {
    name: "Language",
    exact: true,
  });
  await expect(language).toHaveValue("en");
  await expect(
    language.getByRole("option", { name: "English", exact: true }),
  ).toHaveAttribute("lang", "en");
  await expect(
    language.getByRole("option", { name: "Русский", exact: true }),
  ).toHaveAttribute("lang", "ru");
  let navigations = 0;
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  await switchTo(page, "ru");
  expect(navigations).toBe(0);
  const cookie = (await context.cookies()).find(
    (item) => item.name === "adrobot-locale",
  )!;
  expect(cookie.value).toBe("ru");
  expect(cookie.path).toBe("/");
  expect(cookie.sameSite).toBe("Lax");
  expect(cookie.expires).toBeGreaterThan(Date.now() / 1000 + 300 * 86400);
  await page
    .getByRole("link", { name: "Создать кампанию", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Создать кампанию", exact: true }),
  ).toBeVisible();
  await expectMetadata(page, "ru");
  await page.reload();
  await expectMetadata(page, "ru");
  await switchTo(page, "en");
  await page
    .getByRole("link", { name: "Back to campaigns", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Open details for Summer campaign" }),
  ).toBeVisible();
  await expectMetadata(page, "en");
  await page.reload();
  await expectMetadata(page, "en");
});

test("switching preserves creation fields, resource selections, feedback, and navigation guards", async ({
  page,
}) => {
  let writes = 0;
  await page.route(`${api}campaigns`, (route) => {
    writes++;
    return route.fulfill({ status: 422 });
  });
  await page.goto("/campaigns/new");
  await page.getByLabel("Campaign name", { exact: true }).fill("My {campaign}");
  await page.getByLabel("Country codes", { exact: true }).fill("au ru");
  await page.getByLabel("Domain", { exact: true }).selectOption("2");
  await page.getByLabel("Campaign group", { exact: true }).selectOption("2");
  await page.getByLabel("Traffic source", { exact: true }).selectOption("2");
  await page.getByLabel("Search offers by name or ID").fill("Summer");
  await page
    .getByRole("list", { name: "Offer search results" })
    .getByRole("button", { name: /Summer offer/ })
    .click();
  await page.getByRole("button", { name: "Push", exact: true }).click();
  const actions = page.getByRole("region", { name: "Creation actions" });
  await expect(actions.getByRole("alert")).toContainText(
    "Creation was rejected.",
  );
  let dialogs = 0;
  page.on("dialog", async (dialog) => {
    dialogs++;
    await dialog.dismiss();
  });
  await switchTo(page, "ru");
  expect(dialogs).toBe(0);
  expect(writes).toBe(1);
  await expect(
    page.getByLabel("Название кампании", { exact: true }),
  ).toHaveValue("My {campaign}");
  await expect(page.getByLabel("Коды стран", { exact: true })).toHaveValue(
    "AU RU",
  );
  for (const label of ["Домен", "Группа кампаний", "Источник трафика"])
    await expect(page.getByLabel(label, { exact: true })).toHaveValue("2");
  await expect(
    page.getByText("Выбранный оффер: Summer offer", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Действия при создании" })
      .getByRole("alert"),
  ).toContainText("Создание отклонено.");
  await expect(
    page.getByRole("list", { name: "Планируемые потоки" }),
  ).toContainText("Трафик из AU, RU → Google");
  await page
    .getByRole("link", { name: "К списку кампаний", exact: true })
    .click();
  expect(dialogs).toBe(1);
  await expect(page).toHaveURL(/\/campaigns\/new$/);
  await switchTo(page, "en");
  await expect(
    page.getByRole("region", { name: "Creation actions" }).getByRole("alert"),
  ).toContainText("Creation was rejected.");
});

test("switching keeps editor pins, removals, validation, country names, and offer errors", async ({
  page,
}) => {
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "POST") writes++;
  });
  await page.goto("/campaigns/7");
  const editor = page.getByRole("region", { name: "Offers", exact: true });
  const redirect = page.getByRole("region", { name: "Google", exact: true });
  await expect(redirect).toContainText("Russia (RU)");
  await page.getByLabel("Show removed offers").check();
  await editor.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(editor.getByRole("alert")).toHaveText(
    "This offer is no longer available.",
  );
  await editor.getByRole("button", { name: "Pin", exact: true }).click();
  await switchTo(page, "ru");
  await expect(redirect).toContainText("Россия (RU)");
  await expect(editor.getByRole("alert")).toHaveText(
    "Этот оффер больше недоступен.",
  );
  await expect(editor).toContainText("Доля трафика: 100% · Закреплено");
  await expect(page.getByLabel("Показать удалённые офферы")).toBeChecked();
  await editor.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(
    editor.getByText("В потоке должен быть хотя бы один оффер.", {
      exact: true,
    }),
  ).toBeVisible();
  await switchTo(page, "en");
  await expect(
    editor.getByText("A stream must have at least one offer.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Push", exact: true }),
  ).toBeDisabled();
  await expect(editor).toContainText("Pending removal");
  expect(writes).toBe(0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    editor.getByText("Traffic share: 100%", { exact: true }),
  ).toBeVisible();
});

test("switching translates unknown Push feedback and keeps recovery controls locked", async ({
  page,
}) => {
  let writes = 0;
  await page.route(`${api}campaigns/7/push`, (route) => {
    writes++;
    return route.fulfill({ status: 502 });
  });
  await page.goto("/campaigns/7");
  const editor = page.getByRole("region", { name: "Offers", exact: true });
  await editor.getByRole("button", { name: "Pin", exact: true }).click();
  await page.getByRole("button", { name: "Push", exact: true }).click();
  await expect(page.getByLabel("Campaign synchronization")).toContainText(
    "Could not confirm the Push outcome.",
  );
  await switchTo(page, "ru");
  await expect(page.getByLabel("Синхронизация кампании")).toContainText(
    "Не удалось подтвердить результат сохранения.",
  );
  await expect(
    page.getByRole("button", { name: "Сохранить", exact: true }),
  ).toBeDisabled();
  await expect(
    editor.getByRole("button", { name: "Открепить", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Проверить сохранённое состояние" })
    .click();
  await expect(page.getByLabel("Синхронизация кампании")).toContainText(
    "Сохранённое состояние проверено.",
  );
  await expect(
    page.getByRole("button", { name: "Сохранить", exact: true }),
  ).toBeEnabled();
  expect(writes).toBe(1);
});

test("language selection remains usable when cookies are blocked", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, "cookie", {
      configurable: true,
      get: () => "",
      set: () => {
        throw new DOMException("Cookies are blocked", "SecurityError");
      },
    });
  });
  await page.goto("/");
  await switchTo(page, "ru");
  await page
    .getByRole("link", { name: "Создать кампанию", exact: true })
    .click();
  await expectMetadata(page, "ru");
  await expect(
    page.getByRole("heading", { name: "Создать кампанию", exact: true }),
  ).toBeVisible();
});

test("controls fit a narrow screen and preserve theme while changing languages", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  for (const locale of ["ru", "en", "ru"] as const) {
    await switchTo(page, locale);
    await expect(page.locator("html")).toHaveClass(/dark/);
    const header = page.locator("header");
    expect(
      await header.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("combobox", { name: /^(Language|Язык)$/ }),
    ).toBeInViewport();
  }
});

test("the saved locale and metadata are present in the server HTML with JavaScript disabled", async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    await context.addCookies([
      { name: "adrobot-locale", value: "ru", url: "http://127.0.0.1:3199" },
    ]);
    const page = await context.newPage();
    const response = await page.goto("/campaigns/new");
    expect(await response!.text()).toContain('lang="ru"');
    await expectMetadata(page, "ru");
    await expect(
      page.getByRole("heading", { name: "Создать кампанию", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Язык", exact: true }),
    ).toHaveValue("ru");
  } finally {
    await context.close();
  }
});
