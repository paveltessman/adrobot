import { expect, test, type Page } from "@playwright/test";
import type {
  CampaignDetails,
  CampaignStream,
} from "../src/lib/campaign-details";
import type { StreamChange } from "../src/lib/campaign-push";

const api = "**/api/v1/integrations/keitaro/";
const offer = { id: 9, name: "Summer offer", state: "active" };
const secondOffer = { id: 10, name: "Second offer", state: "active" };
const stream: CampaignStream = {
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
  offer_details: [offer],
  pinned_offer_ids: [],
  removed_offers: [
    { id: 10, name: "Second offer", last_known_state: "active" },
  ],
};
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
      ...stream,
      id: 1,
      name: "Google",
      position: 1,
      schema: "redirect",
      action_payload: "https://google.com",
      filters: [{ name: "country", mode: "accept", payload: ["AU", "RU"] }],
      offers: [],
      offer_details: [],
      removed_offers: [],
    },
    stream,
  ],
};
const save = (page: Page) =>
  page.getByRole("button", { name: "Сохранить", exact: true });
const editor = (page: Page) =>
  page.getByRole("region", { name: "Offers", exact: true });

async function setup(page: Page) {
  for (const resource of ["domains", "campaign-groups", "traffic-sources"]) {
    await page.route(`${api}${resource}`, (route) =>
      route.fulfill({ json: { data: [], error: null } }),
    );
  }
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
  await page.route(`${api}offers?*`, (route) =>
    route.fulfill({ json: { data: [offer, secondOffer], error: null } }),
  );
  await page.route(`${api}offers/10`, (route) =>
    route.fulfill({ json: { data: secondOffer, error: null } }),
  );
}
async function fillCreation(page: Page) {
  await page
    .getByLabel("Название кампании", { exact: true })
    .fill("Summer campaign");
  await page.getByLabel("Коды стран", { exact: true }).fill("au, ru");
  await page.getByLabel("Поиск офферов по названию или ID").fill("Summer");
  await page
    .getByRole("list", { name: "Результаты поиска офферов" })
    .getByRole("button", { name: /Summer offer/ })
    .click();
}
async function restore(page: Page) {
  await page.getByLabel("Показать удалённые офферы").check();
  await editor(page)
    .getByRole("button", { name: "Восстановить", exact: true })
    .click();
  await expect(
    editor(page).getByText("ID оффера: 10 · Будет добавлен"),
  ).toBeVisible();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test.beforeEach(async ({ page, context }) => {
  await context.addCookies([
    { name: "adrobot-locale", value: "ru", url: "http://127.0.0.1:3199" },
  ]);
  await setup(page);
});

test("Russian list loading, errors, retry, empty state, theme labels, and pagination", async ({
  page,
}) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  await page.route(`${api}campaigns?*`, async (route) => {
    if (++calls === 1) {
      await gate;
      return route.fulfill({ status: 502, body: "private upstream error" });
    }
    return route.fulfill({
      json: {
        data: { items: [], limit: 20, offset: 0, has_more: false },
        error: null,
      },
    });
  });
  await page.goto("/");
  await expect(page.getByText("Загрузка кампаний…")).toBeVisible();
  release();
  await expect(
    page.getByRole("heading", { name: "Не удалось загрузить кампании" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Кампаний пока нет" }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Страница 1" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Назад", exact: true }),
  ).toBeDisabled();
  const theme = page.getByRole("group", { name: "Цветовая тема" });
  await theme.getByRole("button", { name: "Тёмная тема" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByText("private upstream error")).toHaveCount(0);
  await noOverflow(page);
});

test("Russian list keeps resource names and localizes details links and page ranges", async ({
  page,
}) => {
  await page.route(`${api}campaigns?*`, (route) =>
    route.fulfill({
      json: {
        data: {
          items: [{ id: 7, name: "Summer campaign" }],
          limit: 20,
          offset: 0,
          has_more: false,
        },
        error: null,
      },
    }),
  );
  await page.goto("/");
  await expect(page.getByText("Страница 1 · Показаны 1–1")).toBeVisible();
  await page
    .getByRole("link", { name: "Открыть кампанию «Summer campaign»" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Summer campaign", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Google", exact: true }),
  ).toContainText("Австралия (AU), Россия (RU)");
  await expect(page.getByText("Статус: active")).toHaveCount(0);
  await expect(page.getByLabel("Статус: активен").first()).toBeVisible();
  await noOverflow(page);
});

test("Russian creation validates fields, previews resources, and sends the same API payload", async ({
  page,
}) => {
  let payload: unknown;
  await page.route(`${api}campaigns`, (route) => {
    payload = route.request().postDataJSON();
    return route.fulfill({
      json: {
        data: { status: "created", campaign_id: 7, campaign },
        error: null,
      },
    });
  });
  await page.goto("/campaigns/new");
  await expect(
    page.getByText("Введите название кампании.", { exact: true }),
  ).toBeVisible();
  await expect(save(page)).toBeDisabled();
  await page
    .getByLabel("Название кампании", { exact: true })
    .fill("Summer campaign");
  await expect(
    page.getByText(
      "Введите двухбуквенные коды стран через запятую или пробел, например AU, US.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByLabel("Коды стран").fill("au ru");
  await expect(
    page.getByText("Выберите доступный оффер.", { exact: true }),
  ).toBeVisible();
  await fillCreation(page);
  await expect(
    page.getByRole("list", { name: "Планируемые потоки" }),
  ).toContainText("Трафик из AU, RU → Google");
  await expect(
    page.getByRole("list", { name: "Планируемые потоки" }),
  ).toContainText("ID оффера: 9 · Доля трафика: 100%");
  await expect(page.getByLabel("Домен", { exact: true })).toHaveValue("");
  await expect(
    page.getByLabel("Группа кампаний", { exact: true }),
  ).toContainText("Нет");
  await noOverflow(page);
  await save(page).click();
  await expect(page).toHaveURL(/\/campaigns\/7$/);
  expect(payload).toEqual({
    name: "Summer campaign",
    country_codes: ["AU", "RU"],
    offer_id: 9,
    domain_id: null,
    group_id: null,
    traffic_source_id: null,
  });
});

test("Russian creation handles optional selector failure and search failure/empty results", async ({
  page,
}) => {
  await page.route(`${api}domains`, (route) => route.fulfill({ status: 502 }));
  await page.route(`${api}offers?*`, (route) => route.fulfill({ status: 502 }));
  await page.goto("/campaigns/new");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Не удалось загрузить параметры кампании.",
  );
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(
    page.getByText(
      "Не удалось найти офферы. Нажмите «Найти», чтобы повторить поиск.",
    ),
  ).toBeVisible();
  await page.route(`${api}offers?*`, (route) =>
    route.fulfill({ json: { data: [], error: null } }),
  );
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(page.getByText("Офферы не найдены.")).toBeVisible();
  await page.route(`${api}domains`, (route) =>
    route.fulfill({ json: { data: [], error: null } }),
  );
  await page
    .getByRole("button", { name: "Загрузить параметры повторно" })
    .click();
  await expect(
    page.getByRole("button", { name: "Загрузить параметры повторно" }),
  ).toHaveCount(0);
});

for (const outcome of ["rejected", "partial", "unknown"] as const) {
  test(`Russian creation ${outcome} feedback preserves the draft and warns before leaving`, async ({
    page,
  }) => {
    await page.route(`${api}campaigns`, (route) =>
      outcome === "rejected"
        ? route.fulfill({ status: 422 })
        : route.fulfill({
            json: {
              data:
                outcome === "partial"
                  ? { status: "partial", campaign_id: 7, campaign }
                  : { status: "unknown", campaign_id: null, campaign: null },
              error: null,
            },
          }),
    );
    await page.goto("/campaigns/new");
    await fillCreation(page);
    await save(page).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      outcome === "rejected"
        ? "Создание отклонено. Проверьте поля и доступность ресурсов, затем повторите попытку."
        : outcome === "partial"
          ? "Кампания существует, но её настройка не завершена."
          : "Результат создания неизвестен.",
    );
    await expect(
      page.getByLabel("Название кампании", { exact: true }),
    ).toHaveValue("Summer campaign");
    if (outcome !== "rejected") {
      await expect(save(page)).toBeDisabled();
      await page
        .getByLabel("Я проверил Keitaro и хочу повторить попытку создания.")
        .check();
      await page
        .getByRole("button", { name: "Разрешить повторное создание" })
        .click();
      await expect(page.getByRole("main").getByRole("alert")).toHaveText(
        "Следующее нажатие «Сохранить» создаст новую кампанию.",
      );
    }
    page.once("dialog", async (dialog) => {
      expect(dialog.message()).toBe(
        "Отменить черновик кампании и покинуть страницу?",
      );
      await dialog.dismiss();
    });
    await page
      .getByRole("link", { name: "К списку кампаний", exact: true })
      .click();
    await expect(page).toHaveURL(/\/campaigns\/new$/);
  });
}

test("Russian editor restores, pins, validates removal, and cancels without writing", async ({
  page,
}) => {
  let writes = 0;
  page.on("request", (request) => {
    if (request.method() === "POST") writes++;
  });
  await page.goto("/campaigns/7");
  await restore(page);
  const region = editor(page);
  await expect(
    region.getByText("Предлагаемый трафик: 50%", { exact: true }),
  ).toHaveCount(2);
  const added = region
    .getByRole("listitem")
    .filter({ hasText: "ID оффера: 10 ·" });
  await added.getByRole("button", { name: "Закрепить", exact: true }).click();
  await expect(added).toContainText("· Закреплено");
  await noOverflow(page);
  await region
    .getByRole("button", { name: "Удалить", exact: true })
    .first()
    .click();
  await added.getByRole("button", { name: "Удалить", exact: true }).click();
  await expect(region.getByRole("alert")).toHaveText(
    "В потоке должен быть хотя бы один оффер.",
  );
  await expect(save(page)).toBeDisabled();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Не удалось сохранить поток 2:" }),
  ).toBeVisible();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toBe(
      "Отменить несохранённые изменения офферов и покинуть страницу?",
    );
    await dialog.dismiss();
  });
  await page
    .getByRole("link", { name: "К списку кампаний", exact: true })
    .click();
  await page.getByRole("button", { name: "Отмена", exact: true }).click();
  await expect(
    region.getByText("Доля трафика: 100%", { exact: true }),
  ).toBeVisible();
  expect(writes).toBe(0);
});

test("Russian unavailable-offer and search feedback do not expose raw errors", async ({
  page,
}) => {
  await page.route(`${api}offers/10`, (route) =>
    route.fulfill({ status: 404, body: "private" }),
  );
  await page.goto("/campaigns/7");
  await page.getByLabel("Показать удалённые офферы").check();
  await editor(page)
    .getByRole("button", { name: "Восстановить", exact: true })
    .click();
  await expect(editor(page).getByRole("alert")).toHaveText(
    "Этот оффер больше недоступен.",
  );
  await expect(
    editor(page).getByRole("button", { name: "Восстановить", exact: true }),
  ).toBeDisabled();
  await editor(page)
    .getByRole("button", { name: "Найти", exact: true })
    .click();
  await expect(
    editor(page).getByRole("list", { name: "Результаты поиска офферов" }),
  ).toContainText("Недоступен");
});

for (const outcome of [
  "applied",
  "partial",
  "failed",
  "rejected",
  "unknown",
] as const) {
  test(`Russian Push ${outcome} keeps synchronization behavior and translated feedback`, async ({
    page,
  }) => {
    let writes = 0;
    let saved: CampaignDetails =
      outcome === "partial"
        ? {
            ...campaign,
            streams: [
              ...campaign.streams,
              { ...stream, id: 3, name: "Secondary", removed_offers: [] },
            ],
          }
        : campaign;
    await page.route(`${api}campaigns/7`, (route) =>
      route.fulfill({ json: { data: saved, error: null } }),
    );
    await page.route(`${api}campaigns/7/push`, (route) => {
      writes++;
      const changes = route.request().postDataJSON().streams as StreamChange[];
      if (outcome === "rejected") return route.fulfill({ status: 422 });
      if (outcome === "applied" || outcome === "partial") {
        saved = {
          ...saved,
          streams: saved.streams.map((item) => {
            const change = changes.find((value) => value.stream_id === item.id);
            if (!change || (outcome === "partial" && item.id !== 2))
              return item;
            return {
              ...item,
              offers: change.offers,
              pinned_offer_ids: change.pinned_offer_ids,
            };
          }),
        };
      }
      const pending =
        outcome === "applied"
          ? []
          : outcome === "partial"
            ? changes.filter((value) => value.stream_id !== 2)
            : changes;
      return route.fulfill({
        json: {
          data: {
            status: outcome,
            campaign: outcome === "unknown" ? null : saved,
            pending_streams: pending,
          },
          error: null,
        },
      });
    });
    await page.goto("/campaigns/7");
    await editor(page)
      .getByRole("button", { name: "Закрепить", exact: true })
      .click();
    if (outcome === "partial")
      await page
        .getByRole("region", { name: "Secondary", exact: true })
        .getByRole("button", { name: "Закрепить", exact: true })
        .click();
    await save(page).click();
    const feedback = page.getByLabel("Синхронизация кампании");
    await expect(feedback).toContainText(
      {
        applied: "Изменения сохранены.",
        partial: "Часть изменений сохранена.",
        failed: "Изменения не сохранены.",
        rejected: "Сохранение отклонено.",
        unknown: "Результат сохранения неизвестен.",
      }[outcome],
    );
    expect(writes).toBe(1);
    if (outcome === "unknown") {
      await expect(save(page)).toBeDisabled();
      await page
        .getByRole("button", { name: "Проверить сохранённое состояние" })
        .click();
      await expect(feedback).toContainText(
        "Сохранённое состояние проверено. Проверьте оставшиеся изменения",
      );
      await expect(save(page)).toBeEnabled();
    }
  });
}

test("Russian details handles load failures, missing campaigns, empty streams, and rejected country filters", async ({
  page,
}) => {
  await page.route(`${api}campaigns/7`, (route) =>
    route.fulfill({ status: 502 }),
  );
  await page.goto("/campaigns/7");
  await expect(
    page.getByRole("heading", { name: "Не удалось загрузить кампанию" }),
  ).toBeVisible();
  await page.route(`${api}campaigns/7`, (route) =>
    route.fulfill({
      json: {
        data: {
          ...campaign,
          streams: [
            {
              ...campaign.streams[0],
              filters: [{ name: "country", mode: "reject", payload: ["RU"] }],
            },
            { ...stream, offers: [], offer_details: [], removed_offers: [] },
          ],
        },
        error: null,
      },
    }),
  );
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Google", exact: true }),
  ).toContainText("Кроме: Россия (RU)");
  await expect(editor(page)).toContainText(
    "К этому потоку не прикреплены офферы.",
  );
  await page.route(`${api}campaigns/7`, (route) =>
    route.fulfill({ status: 404 }),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Кампания не найдена" }),
  ).toBeVisible();
});
