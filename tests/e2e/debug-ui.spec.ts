import { test, expect } from "@playwright/test";

test("debug studio explains upload and displays rate limits", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /From mirror selfie/ })).toBeVisible();
  await expect(page.getByText("10 uploads per IP")).toBeVisible();
  await expect(page.getByText("OpenAI usage & cost")).toBeAttached();
  await expect(page.getByRole("button", { name: /Create outfit canvas/ })).toBeVisible();
});
