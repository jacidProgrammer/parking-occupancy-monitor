import { expect, test } from "@playwright/test";
import { alerts, mockAnalysis, PHOTO, upload } from "./helpers";

const stat = (page: import("@playwright/test").Page, name: string) => page.getByTestId(`stat-${name}`);

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("Total parking spaces")).toBeEnabled();
});

test("a photo is cut into nine JPEG tiles and its result is drawn, counted and remembered", async ({ page }) => {
  const requests = await mockAnalysis(page);
  await expect(page).toHaveTitle("Parking Lot Occupancy Monitor");
  await expect(page.getByText("Shown after your first upload.")).toBeVisible();

  await upload(page);

  await expect(page.getByTestId("count-car")).toHaveText("1 cars");
  await expect(page.getByTestId("count-free")).toHaveText("2 free bays");
  expect(requests).toHaveLength(9);
  for (const request of requests) {
    expect(request.contentType).toMatch(/^multipart\/form-data; boundary=/);
    const body = request.body.toString("latin1");
    expect(body).toContain('name="image"; filename="tile.jpg"');
    expect(body).toContain("Content-Type: image/jpeg");
    expect(body).toContain("ÿØÿ"); // the bytes a JPEG starts with
  }

  await expect(stat(page, "total")).toHaveText("3");
  await expect(stat(page, "occupied")).toHaveText("1");
  await expect(stat(page, "free")).toHaveText("2");
  await expect(page.getByTestId("gauge-percent")).toHaveText("33.3%");
  await expect(page.getByTestId("status")).toHaveText("Plenty of space");
  await expect(page.getByTestId("total-source")).toHaveText(
    "Total counted in the photo: 1 cars + 2 free bays = 3 spaces.",
  );

  // The canvas holds the photo at its own size, tinted blue over the car and green over a free bay.
  // The boxes are painted once the photo has loaded again, a moment after the counts appear.
  const canvas = page.getByRole("img", { name: /Uploaded photo with 1 cars/ });
  await expect(async () => {
    const pixels = await canvas.evaluate((element: HTMLCanvasElement) => {
      const ctx = element.getContext("2d")!;
      const at = (x: number, y: number) => Array.from(ctx.getImageData(x, y, 1, 1).data.slice(0, 3));
      // First tile is 360×240 at the corner: the car spans x 72–144, y 48–144; the free bay x 180–252.
      return { size: [element.width, element.height], car: at(108, 96), free: at(216, 96), nothing: at(800, 500) };
    });
    expect(pixels.size).toEqual([900, 600]);
    expect(pixels.nothing).toEqual([128, 128, 128]);
    expect(pixels.car[2]).toBeGreaterThan(pixels.car[0] + 20);
    expect(pixels.free[1]).toBeGreaterThan(pixels.free[0] + 10);
    expect(pixels.free[1]).toBeGreaterThan(pixels.free[2] + 10);
  }).toPass({ timeout: 5000 });

  const item = page.getByTestId("history-item");
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("lot.png");
  await expect(item).toContainText("1 of 3 spaces");
  await expect(item.locator("img")).toHaveAttribute("src", /^data:image\/jpeg;base64,/);

  // The trend has one dot; hovering it tells the same numbers.
  const dot = page.getByTestId("trend-chart").locator("circle");
  await expect(dot).toHaveCount(1);
  await dot.hover();
  await expect(page.getByTestId("trend-chart")).toContainText("#1 · 33.3%");
  await expect(page.getByTestId("trend-chart")).toContainText("1 of 3 spaces");

  // A reload keeps the numbers and the history, not the photo.
  await page.reload();
  await expect(stat(page, "total")).toHaveText("3");
  await expect(page.getByTestId("history-item")).toHaveCount(1);
  await expect(page.getByRole("img", { name: /Uploaded photo/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Delete lot.png from history" }).click();
  await expect(page.getByTestId("history-item")).toHaveCount(0);
  await expect(page.getByText("Shown after your first upload.")).toBeVisible();
  await page.reload();
  await expect(page.getByText(/^No uploads yet\./)).toBeVisible();
});

test("a typed capacity is the total, is remembered, and is flagged when the photo disagrees", async ({ page }) => {
  await mockAnalysis(page);
  await page.getByLabel("Total parking spaces").fill("10");
  await upload(page);
  await expect(stat(page, "total")).toHaveText("10");
  await expect(stat(page, "free")).toHaveText("9");
  await expect(page.getByTestId("gauge-percent")).toHaveText("10%");
  await expect(page.getByTestId("total-source")).toHaveText(
    "Total entered by you: 10. The photo shows 1 cars + 2 free bays = 3 spaces.",
  );
  await expect(alerts(page).filter({ hasText: "differ by more than 10%" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Total parking spaces")).toHaveValue("10");
});

test("clearing the history asks first and says how many uploads go", async ({ page }) => {
  await mockAnalysis(page);
  await upload(page);
  await expect(page.getByTestId("history-item")).toHaveCount(1);
  await upload(page, { ...PHOTO, name: "second.png" });
  await expect(page.getByTestId("history-item")).toHaveCount(2);

  const messages: string[] = [];
  page.once("dialog", (dialog) => {
    messages.push(dialog.message());
    void dialog.dismiss();
  });
  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(page.getByTestId("history-item")).toHaveCount(2);

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(page.getByTestId("history-item")).toHaveCount(0);
  expect(messages).toEqual(["Delete all 2 uploads from the history?"]);
});

test("a photo with nothing in it is an error, not 0 % occupancy", async ({ page }) => {
  const requests = await mockAnalysis(page, () => []);
  await page.getByLabel("Total parking spaces").fill("100");
  await upload(page);
  await expect(alerts(page)).toContainText("The model found no cars and no free bays in this photo.");
  expect(requests).toHaveLength(9);
  await expect(page.getByTestId("history-item")).toHaveCount(0);
  await expect(page.getByTestId("gauge-percent")).toHaveCount(0);
});

test("a short rate limit is waited out; a long one is shown and not retried", async ({ page }) => {
  const limited = (retryAfterSeconds: number, message: string) => ({
    status: 429,
    body: { error: { code: "rate_limited", message, retryAfterSeconds } },
  });
  let requests = await mockAnalysis(page, (call) => (call === 2 ? limited(1, "Azure is busy.") : []));
  await upload(page);
  await expect(alerts(page)).toContainText("The model found no cars");
  expect(requests).toHaveLength(10);

  await page.unroute("**/api/analyze-parking");
  requests = await mockAnalysis(page, () => limited(3268, "This demo allows 10 photos per hour per visitor. Try again in 54 minutes."));
  await upload(page);
  await expect(alerts(page)).toHaveText("This demo allows 10 photos per hour per visitor. Try again in 54 minutes.");
  expect(requests).toHaveLength(1);
  await expect(page.getByLabel("Upload parking lot photo")).toBeEnabled();
});

test("a file that is not a photo is refused before anything is sent", async ({ page }) => {
  const requests = await mockAnalysis(page);
  await upload(page, { name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") });
  await expect(alerts(page)).toHaveText("Unsupported file type. Use JPEG, PNG, GIF, BMP or WEBP.");
  expect(requests).toHaveLength(0);
});

test("a file the browser cannot decode is reported", async ({ page }) => {
  const requests = await mockAnalysis(page);
  await upload(page, { name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not a png") });
  await expect(alerts(page)).toHaveText("This browser could not read the image.");
  expect(requests).toHaveLength(0);
});

test("on a phone nothing overflows sideways, before or after an upload", async ({ page }) => {
  await mockAnalysis(page);
  await page.setViewportSize({ width: 375, height: 812 });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(await overflow()).toBeLessThanOrEqual(0);
  await upload(page);
  await expect(page.getByTestId("history-item")).toHaveCount(1);
  expect(await overflow()).toBeLessThanOrEqual(0);
  const canvas = await page.getByRole("img", { name: /Uploaded photo/ }).boundingBox();
  expect(canvas!.width).toBeLessThanOrEqual(375);
});
