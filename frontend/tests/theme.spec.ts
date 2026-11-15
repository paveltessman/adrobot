import { expect, test } from "@playwright/test";

test("follows the system and remembers an explicit theme across navigation and reload", async ({
  page,
}) => {
  await page.route("**/api/v1/**", (route) =>
    route.fulfill({
      json: { data: { items: [], has_more: false }, error: null },
    }),
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const theme = page.getByRole("group", { name: "Color theme" });
  await expect(
    theme.getByRole("button", { name: "System theme" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await theme.getByRole("button", { name: "Dark theme" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("link", { name: "Create campaign" }).first().click();
  await expect(
    theme.getByRole("button", { name: "Dark theme" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(
    theme.getByRole("button", { name: "Dark theme" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await theme.getByRole("button", { name: "Light theme" }).click();
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).not.toHaveClass(/dark/);
  await theme.getByRole("button", { name: "System theme" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
