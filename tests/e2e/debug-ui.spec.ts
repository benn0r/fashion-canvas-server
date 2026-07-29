import { test, expect } from "@playwright/test";

test("debug studio explains upload and displays rate limits", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /From mirror selfie/ })).toBeVisible();
  await expect(page.getByText("10 uploads per IP")).toBeVisible();
  await expect(page.getByText("OpenAI usage & cost")).toBeAttached();
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
