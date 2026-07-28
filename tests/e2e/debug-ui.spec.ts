import { test, expect } from "@playwright/test";

test("debug console exposes the request builder and runtime telemetry", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Image pipeline debug console/ })).toBeVisible();
  await expect(page.getByText("CLIENT_RATE_LIMITS")).toBeVisible();
  await expect(page.getByRole("button", { name: /RUN_PIPELINE/ })).toBeVisible();
  await expect(page.getByText("input_long_edge")).toBeVisible();
});
