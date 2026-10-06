import { deflateSync } from "node:zlib";
import type { Page, Route } from "@playwright/test";

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  let crc = 0xffffffff;
  for (let i = 0; i < body.length; i += 1) {
    crc ^= body[i];
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, checksum]);
}

/** A plain mid-grey PNG: a real image the browser can decode, with nothing in it. */
export function greyPng(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 0, 0, 0, 0], 8); // 8-bit greyscale
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width, 128)]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", pixels),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export const PHOTO = { name: "lot.png", mimeType: "image/png", buffer: greyPng(900, 600) };

/** What the first tile of each photo "sees": one car and two free bays, as fractions of the tile. */
export const FIRST_TILE = [
  { kind: "car", confidence: 0.95, box: { x: 0.2, y: 0.2, w: 0.2, h: 0.4 } },
  { kind: "free", confidence: 0.9, box: { x: 0.5, y: 0.2, w: 0.2, h: 0.4 } },
  { kind: "free", confidence: 0.85, box: { x: 0.2, y: 0.7, w: 0.2, h: 0.2 } },
];

/**
 * Answers the analysis API in place of the server. `respond` gets the call number from 1
 * and returns the detections, or a full response to send instead.
 */
export async function mockAnalysis(
  page: Page,
  respond: (call: number) => unknown[] | { status: number; body: unknown } = (call) => (call % 9 === 1 ? FIRST_TILE : []),
) {
  const requests: { contentType: string; body: Buffer }[] = [];
  await page.route("**/api/analyze-parking", async (route: Route) => {
    const request = route.request();
    requests.push({
      contentType: request.headers()["content-type"] ?? "",
      body: request.postDataBuffer() ?? Buffer.alloc(0),
    });
    const answer = respond(requests.length);
    if (Array.isArray(answer)) await route.fulfill({ json: { detections: answer } });
    else await route.fulfill({ status: answer.status, json: answer.body });
  });
  return requests;
}

export const upload = (page: Page, photo = PHOTO) => page.getByLabel("Upload parking lot photo").setInputFiles(photo);

/** The app's own alerts. Next adds an empty one of its own to announce navigations. */
export const alerts = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');
