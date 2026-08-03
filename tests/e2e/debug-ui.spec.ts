import { test, expect } from "@playwright/test";

test("admin console shows operations, history, and test tooling", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Admin console" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Admin navigation" })).toBeVisible();
  await expect(page.getByText("System operational")).toBeVisible();
  await expect(page.getByText("Recent uploads")).toBeVisible();
  await expect(page.locator("#metric-uploads")).toHaveText(/\d+/);
  await expect(page.getByText("10 uploads per IP")).toBeVisible();
  await expect(page.locator("#overview").getByText("Client limits")).toHaveCount(0);
  await expect(page.locator("#test-studio").getByText("Client limits")).toHaveCount(0);
  await expect(page.getByRole("complementary").getByText("Client limits")).toBeVisible();
  await expect(page.getByText("OpenAI usage & cost")).toBeAttached();
  await expect(page.getByRole("heading", { name: "Upload history" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "File size" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Test studio" })).toBeVisible();
  await expect(page.getByText(/photos are never stored/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /Create outfit canvas/ })).toBeVisible();
});

test("shows a crop editor for a browser-readable reference image", async ({ page }) => {
  await page.goto("/");
  await page.locator("#photo").setInputFiles({
    name: "fantasy-look.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  await expect(page.getByRole("heading", { name: "Crop OpenAI reference" })).toBeVisible();
  await expect(page.getByText(/Source crop 2×2/)).toBeVisible();
  await page.locator('[data-crop="left"]').evaluate((control: HTMLInputElement) => {
    control.value = "40";
    control.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await expect(page.getByText(/Source crop 1×2/)).toBeVisible();
});
