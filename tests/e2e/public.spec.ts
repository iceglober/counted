import { test, expect } from "@playwright/test";

// Unauthenticated flows. No storage state.

test("login page renders the magic-link form", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /send magic link/i })).toBeVisible();
  await expect(page.getByRole("textbox")).toBeVisible(); // email input
});

test("unauthenticated app route redirects to login", async ({ page }) => {
  await page.goto("/dashboards");
  await expect(page).toHaveURL(/\/login/);
});

test("marketing home renders", async ({ page }) => {
  const res = await page.goto("/");
  expect(res?.status()).toBeLessThan(400);
  await expect(page.getByText(/counted/i).first()).toBeVisible();
});
