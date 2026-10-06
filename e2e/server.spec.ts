import { expect, test } from "@playwright/test";
import { alerts, PHOTO, upload } from "./helpers";

// These go through the real route of the running server, which has no Azure settings.
// Kept last (file order): the final test uses up the server's per-visitor allowance.

test("the page declares its language and description", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    "Parking lot occupancy from a photo, using a model trained with Azure Custom Vision",
  );
});

test("the screen shows the server's own explanation when the model is not configured", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Total parking spaces")).toBeEnabled();
  await upload(page);
  await expect(alerts(page)).toContainText("The Custom Vision model is not configured.");
  await expect(page.getByTestId("history-item")).toHaveCount(0);
});

test("the server validates uploads and never serves the key to the browser", async ({ page, request }) => {
  const empty = await request.post("/api/analyze-parking", { multipart: { other: "1" } });
  expect(empty.status()).toBe(400);
  expect((await empty.json()).error.code).toBe("missing_file");

  const text = await request.post("/api/analyze-parking", {
    multipart: { image: { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("hello") } },
  });
  expect(text.status()).toBe(415);

  const tile = await request.post("/api/analyze-parking", { multipart: { image: PHOTO } });
  expect(tile.status()).toBe(503);
  expect((await tile.json()).error.code).toBe("not_configured");

  // No script the page loads mentions the server-side settings.
  const scripts: string[] = [];
  page.on("response", async (response) => {
    if (response.url().endsWith(".js")) scripts.push(await response.text().catch(() => ""));
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  expect(scripts.length).toBeGreaterThan(0);
  expect(scripts.filter((script) => script.includes("AZURE_CUSTOM_VISION_PREDICTION_KEY"))).toEqual([]);
});

test("the 91st request of a visitor in an hour is refused with the wait", async ({ request }) => {
  const send = () => request.post("/api/analyze-parking", { multipart: { other: "1" } });
  let allowed = 0;
  for (;;) {
    const response = await send();
    if (response.status() === 429) {
      const body = await response.json();
      expect(body.error.code).toBe("too_many_requests");
      expect(body.error.message).toMatch(/^This demo allows 10 photos per hour per visitor\. Try again in /);
      expect(Number(response.headers()["retry-after"])).toBeGreaterThan(3000);
      break;
    }
    expect(response.status()).toBe(400);
    allowed += 1;
    expect(allowed).toBeLessThanOrEqual(90);
  }
  // Earlier tests in this file already spent part of the 90.
  expect(allowed).toBeGreaterThan(60);
  expect(allowed).toBeLessThan(90);
});
