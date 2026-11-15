import { expect, test } from "@playwright/test";

for (const [cookie, locale, title, description] of [
  [
    undefined,
    "en",
    "Adrobot | Campaign management",
    "Create and manage Keitaro advertising campaigns with Adrobot.",
  ],
  [
    "invalid",
    "en",
    "Adrobot | Campaign management",
    "Create and manage Keitaro advertising campaigns with Adrobot.",
  ],
  [
    "ru",
    "ru",
    "Adrobot | Управление кампаниями",
    "Создавайте рекламные кампании Keitaro и управляйте ими с помощью Adrobot.",
  ],
] as const) {
  test(`renders document language and metadata for cookie ${cookie}`, async ({
    page,
    context,
  }) => {
    if (cookie) {
      await context.addCookies([
        { name: "adrobot-locale", value: cookie, url: "http://127.0.0.1:3199" },
      ]);
    }
    await page.route("**/api/v1/**", (route) =>
      route.fulfill({
        json: {
          data: { items: [], limit: 100, offset: 0, has_more: false },
          error: null,
        },
      }),
    );
    const response = await page.goto("/");
    expect(await response!.text()).toContain(`lang="${locale}"`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page).toHaveTitle(title);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      description,
    );
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page).toHaveTitle(title);
  });
}
