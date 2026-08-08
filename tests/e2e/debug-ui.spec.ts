import { test, expect } from "@playwright/test";

test("admin console shows operations, history, and test tooling", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Admin console" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Admin navigation" })).toBeVisible();
  await expect(page.locator('.brand img[src="/app-icon.png"]')).toBeVisible();
  await expect(page.locator('link[rel="icon"][href="/app-icon.png"]')).toHaveCount(1);
  await expect(page.getByRole("navigation").getByRole("link", { name: "Uploads" })).toHaveCount(0);
  await expect(page.getByText("System operational")).toBeVisible();
  await expect(page.getByText("Recent uploads")).toBeVisible();
  await expect(page.locator("#metric-uploads")).toHaveText(/\d+/);
  await expect(page.getByText("10 uploads per IP")).toBeVisible();
  await expect(page.getByRole("complementary").getByText("Client limits")).toBeVisible();
  await expect(page.locator("#test-studio")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Create outfit canvas/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Upload history" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "File size" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "User" })).toBeVisible();
  await expect(page.getByText(/photos are never stored/i)).toBeVisible();
  await page.getByRole("link", { name: "Users" }).click();
  await expect(page).toHaveURL(/\/users\.html$/);
  await expect(page.getByRole("heading", { name: "User accounts" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Username" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Approval vouchers" })).toBeVisible();
  await page.getByRole("link", { name: "Test studio" }).click();
  await expect(page).toHaveURL(/\/studio\.html$/);
  await expect(page.getByRole("heading", { name: "Test studio" })).toBeVisible();
  await expect(page.locator('.brand img[src="/app-icon.png"]')).toBeVisible();
  await expect(page.locator('link[rel="icon"][href="/app-icon.png"]')).toHaveCount(1);
  await expect(page.getByText("OpenAI usage & cost")).toBeAttached();
  await expect(page.getByRole("button", { name: /Create outfit canvas/ })).toBeVisible();
});

test("confirms approval and can revoke it from user administration", async ({ page }) => {
  const registration = await page.request.post("/api/auth/register", {
    data: { username: "fantasy_user", password: "fantasy-password-123" },
  });
  expect(registration.status()).toBe(201);
  await page.goto("/users.html");
  const row = page.getByRole("row").filter({ hasText: "fantasy_user" });
  await expect(row.getByText("Pending")).toBeVisible();
  const approveBox = await row.getByRole("button", { name: "Approve" }).boundingBox();
  page.once("dialog", (dialog) => dialog.dismiss());
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(row.getByText("Pending")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(row.getByText("Approved")).toBeVisible();
  const revokeBox = await row.getByRole("button", { name: "Revoke approval" }).boundingBox();
  expect(revokeBox?.width).toBe(approveBox?.width);
  expect(revokeBox?.height).toBe(approveBox?.height);
  page.once("dialog", (dialog) => dialog.accept());
  await row.getByRole("button", { name: "Revoke approval" }).click();
  await expect(row.getByText("Pending")).toBeVisible();
});

test("generates a single-use approval voucher in user administration", async ({ page }) => {
  await page.goto("/users.html");
  await page.getByRole("button", { name: "Generate voucher" }).click();
  const generated = page.locator("#generated-voucher");
  await expect(generated).toHaveText(/^FC-(?:[A-F0-9]{8}-){3}[A-F0-9]{8}$/);
  const prefix = (await generated.textContent())?.slice(0, 11);
  await expect(page.locator("#voucher-list").getByText(`${prefix}…`)).toBeVisible();
  await expect(page.locator("#voucher-list").getByText("Available").first()).toBeVisible();
});

test("shows a crop editor for a browser-readable reference image", async ({ page }) => {
  await page.goto("/studio.html");
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
  const leftCrop = page.locator('[data-crop="left"]');
  await leftCrop.focus();
  await leftCrop.press("End");
  await expect(leftCrop).toHaveValue("40");
  await expect(page.getByText(/Source crop 1×2/)).toBeVisible();
});

test("queues a 5xx upload and retries it manually after reload", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/outfits", async (route) => {
    attempts += 1;
    await route.fulfill({
      status: attempts === 1 ? 503 : 200,
      contentType: "application/json",
      body:
        attempts === 1
          ? JSON.stringify({ error: "Service unavailable" })
          : JSON.stringify({ styledOutfit: "data:image/png;base64,AA==", pieces: [] }),
    });
  });
  await page.goto("/studio.html");
  await page.locator("#photo").setInputFiles({
    name: "fantasy-retry.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==",
      "base64",
    ),
  });
  await page.getByRole("button", { name: /Create outfit canvas/ }).click();
  await expect(page.getByRole("heading", { name: "Waiting uploads" })).toBeVisible();
  await expect(page.getByText("fantasy-retry.png")).toBeVisible();

  await page.reload();
  await expect(page.getByText("fantasy-retry.png")).toBeVisible();
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Queued upload completed successfully.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Waiting uploads" })).toHaveCount(0);
});
