import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/analyze-parking/route";
import {
  resetRateLimits,
  TOTAL_REQUESTS_PER_DAY,
  VISITOR_REQUESTS_PER_HOUR,
} from "@/lib/server/request-guard";
import { isAcceptedImageType, isPhotoType, MAX_IMAGE_BYTES } from "@/lib/limits";
import type { CustomVisionResponse } from "@/lib/types";

const PREDICTION_URL =
  "https://demo.cognitiveservices.azure.com/customvision/v3.0/Prediction/p1/detect/iterations/Iteration1/image";

/** Shape of a real Custom Vision object-detection prediction response. */
const prediction: CustomVisionResponse = {
  predictions: [
    { probability: 0.97, tagName: "car", boundingBox: { left: 0.1, top: 0.2, width: 0.25, height: 0.5 } },
    { probability: 0.81, tagName: "free", boundingBox: { left: 0.5, top: 0.2, width: 0.25, height: 0.5 } },
    { probability: 0.3, tagName: "car", boundingBox: { left: 0.75, top: 0.25, width: 0.125, height: 0.5 } },
    { probability: 0.29, tagName: "car", boundingBox: { left: 0, top: 0, width: 0.1, height: 0.1 } },
    { probability: 0.95, tagName: "truck", boundingBox: { left: 0, top: 0, width: 0.1, height: 0.1 } },
    { probability: 0.9, tagName: "free", boundingBox: { left: 0.875, top: -0.125, width: 0.25, height: 0.25 } },
    { probability: 0.6, tagName: "car", boundingBox: { left: -0.125, top: 0.5, width: 0.25, height: 0.25 } },
  ],
};

function request(file?: File, field = "image", headers: Record<string, string> = {}) {
  const form = new FormData();
  if (file) form.set(field, file);
  return new Request("http://localhost/api/analyze-parking", { method: "POST", body: form, headers });
}

const from = (forwardedFor: string) => request(jpeg(), "image", { "x-forwarded-for": forwardedFor });

const jpeg = (bytes = 10, name = "tile.jpg") =>
  new File([new Uint8Array(bytes)], name, { type: "image/jpeg" });

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

function mockAzure(respond: () => Response | Promise<Response> = () => json(prediction)) {
  const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => respond());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  resetRateLimits();
  vi.stubEnv("AZURE_CUSTOM_VISION_PREDICTION_URL", PREDICTION_URL);
  vi.stubEnv("AZURE_CUSTOM_VISION_PREDICTION_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/analyze-parking", () => {
  it("returns cars and free bays at or above the confidence threshold, with their boxes", async () => {
    const fetchMock = mockAzure();
    const res = await POST(request(jpeg()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.detections).toEqual([
      { kind: "car", confidence: 0.97, box: { x: 0.1, y: 0.2, w: 0.25, h: 0.5 } },
      { kind: "free", confidence: 0.81, box: { x: 0.5, y: 0.2, w: 0.25, h: 0.5 } },
      { kind: "car", confidence: 0.3, box: { x: 0.75, y: 0.25, w: 0.125, h: 0.5 } },
      // Clipped to the image: it stuck out of the top and the right.
      { kind: "free", confidence: 0.9, box: { x: 0.875, y: 0, w: 0.125, h: 0.125 } },
      // And this one out of the left.
      { kind: "car", confidence: 0.6, box: { x: 0, y: 0.5, w: 0.125, h: 0.25 } },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("calls the published model with the prediction key in a header and a binary body", async () => {
    const fetchMock = mockAzure();
    await POST(request(jpeg()));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(PREDICTION_URL);
    expect(String(url)).not.toContain("test-key");
    const headers = new Headers(init!.headers);
    expect(headers.get("Prediction-Key")).toBe("test-key");
    expect(headers.get("Content-Type")).toBe("application/octet-stream");
    expect(init!.method).toBe("POST");
    expect((init!.body as ArrayBuffer).byteLength).toBe(10);
  });

  it("returns an empty list when the model finds nothing", async () => {
    mockAzure(() => json({ predictions: [] }));
    const res = await POST(request(jpeg()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ detections: [] });
  });

  it("400 when no file is sent, without calling Azure", async () => {
    const fetchMock = mockAzure();
    const res = await POST(request());
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("missing_file");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400 when the body is not multipart", async () => {
    mockAzure();
    const res = await POST(
      new Request("http://localhost/api/analyze-parking", { method: "POST", body: "nope" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
  });

  it("415 for a non-image and for WEBP, which Custom Vision does not accept", async () => {
    const fetchMock = mockAzure();
    for (const type of ["application/pdf", "image/webp"]) {
      const res = await POST(request(new File([new Uint8Array(10)], "x", { type })));
      expect(res.status).toBe(415);
      expect((await res.json()).error.code).toBe("unsupported_type");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400 for an empty file", async () => {
    mockAzure();
    const res = await POST(request(jpeg(0)));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("empty_file");
  });

  it("413 over the 4 MB limit, without calling Azure", async () => {
    const fetchMock = mockAzure();
    const res = await POST(request(jpeg(MAX_IMAGE_BYTES + 1)));
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("file_too_large");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["AZURE_CUSTOM_VISION_PREDICTION_URL", "AZURE_CUSTOM_VISION_PREDICTION_KEY"])(
    "503 when %s is missing",
    async (name) => {
      vi.stubEnv(name, "");
      const fetchMock = mockAzure();
      const res = await POST(request(jpeg()));
      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe("not_configured");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    [401, "azure_auth", 502],
    [403, "azure_auth", 502],
    [404, "azure_endpoint", 502],
    [500, "azure_error", 502],
  ])("maps Azure %i to %s", async (azureStatus, code, status) => {
    mockAzure(() => json({ code: "X", message: "nope" }, azureStatus));
    const res = await POST(request(jpeg()));
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe(code);
  });

  it("maps Azure 400 to 422 invalid_image with Azure's reason", async () => {
    mockAzure(() => json({ code: "BadRequestImageFormat", message: "Bad Request Image Format" }, 400));
    const res = await POST(request(jpeg()));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_image");
    expect(body.error.message).toContain("Bad Request Image Format");
  });

  it("forwards Retry-After on 429", async () => {
    mockAzure(() => json({ error: { message: "slow down" } }, 429, { "Retry-After": "7" }));
    const res = await POST(request(jpeg()));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("7");
    expect((await res.json()).error).toMatchObject({ code: "rate_limited", retryAfterSeconds: 7 });
  });

  it("502 when Azure is unreachable", async () => {
    mockAzure(() => {
      throw new TypeError("fetch failed");
    });
    const res = await POST(request(jpeg()));
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("azure_unreachable");
  });

  it("504 when Azure times out", async () => {
    mockAzure(() => {
      throw new DOMException("timed out", "TimeoutError");
    });
    const res = await POST(request(jpeg()));
    expect(res.status).toBe(504);
    expect((await res.json()).error.code).toBe("azure_timeout");
  });
});

describe("protection against mass requests", () => {
  it("429 once a visitor has used their hourly allowance, without calling Azure again", async () => {
    const fetchMock = mockAzure();
    for (let i = 0; i < VISITOR_REQUESTS_PER_HOUR; i += 1) {
      expect((await POST(from("203.0.113.7:5000"))).status).toBe(200);
    }
    const res = await POST(from("203.0.113.7:5001"));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe("too_many_requests");
    expect(body.error.message).toContain("10 photos per hour");
    expect(body.error.retryAfterSeconds).toBeGreaterThan(0);
    expect(res.headers.get("Retry-After")).toBe(String(body.error.retryAfterSeconds));
    expect(fetchMock).toHaveBeenCalledTimes(VISITOR_REQUESTS_PER_HOUR);
  });

  it("does not let one visitor's limit affect another", async () => {
    mockAzure();
    for (let i = 0; i <= VISITOR_REQUESTS_PER_HOUR; i += 1) await POST(from("203.0.113.7:5000"));
    expect((await POST(from("198.51.100.9:5000"))).status).toBe(200);
  });

  it("cannot be dodged by sending a made-up X-Forwarded-For", async () => {
    mockAzure();
    for (let i = 0; i < VISITOR_REQUESTS_PER_HOUR; i += 1) await POST(from(`10.0.0.${i}, 203.0.113.7:5000`));
    expect((await POST(from("10.9.9.9, 203.0.113.7:5000"))).status).toBe(429);
  });

  it("counts requests that fail validation too", async () => {
    mockAzure();
    for (let i = 0; i < VISITOR_REQUESTS_PER_HOUR; i += 1) {
      await POST(request(undefined, "image", { "x-forwarded-for": "203.0.113.7:5000" }));
    }
    expect((await POST(from("203.0.113.7:5000"))).status).toBe(429);
  });

  it("429 for everyone once the app has used its daily allowance", async () => {
    const fetchMock = mockAzure();
    for (let i = 0; i < TOTAL_REQUESTS_PER_DAY; i += 1) {
      expect((await POST(from(`203.0.113.${i % 250}:5000`))).status).toBe(200);
    }
    const res = await POST(from("198.51.100.9:5000"));
    expect(res.status).toBe(429);
    expect((await res.json()).error.code).toBe("daily_limit_reached");
    expect(fetchMock).toHaveBeenCalledTimes(TOTAL_REQUESTS_PER_DAY);
  });

  it("does not spend the shared daily allowance on a visitor who is already over their own", async () => {
    mockAzure();
    for (let i = 0; i < VISITOR_REQUESTS_PER_HOUR + 500; i += 1) await POST(from("203.0.113.7:5000"));
    expect((await POST(from("198.51.100.9:5000"))).status).toBe(200);
  });

  it("413 from the declared length alone, without reading the body or calling Azure", async () => {
    const fetchMock = mockAzure();
    const res = await POST(
      new Request("http://localhost/api/analyze-parking", {
        method: "POST",
        body: "x",
        headers: { "content-length": String(MAX_IMAGE_BYTES + 1024 * 1024) },
      }),
    );
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("file_too_large");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("upload formats", () => {
  it("takes WEBP as a photo in the browser but never sends it to Azure", () => {
    expect(isPhotoType("image/webp")).toBe(true);
    expect(isAcceptedImageType("image/webp")).toBe(false);
  });

  it.each(["image/jpeg", "image/png", "image/gif", "image/bmp"])("takes %s as a photo", (type) =>
    expect(isPhotoType(type)).toBe(true),
  );

  it.each(["application/pdf", "image/svg+xml", "image/heic", ""])("refuses %j", (type) =>
    expect(isPhotoType(type)).toBe(false),
  );
});

describe("answers Azure is not expected to give", () => {
  it("500 internal_error, logged, when a prediction comes without its box", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mockAzure(() => json({ predictions: [{ probability: 0.9, tagName: "car" }] }));
    const res = await POST(request(jpeg()));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toEqual({
      code: "internal_error",
      message: "Unexpected error while analyzing the image.",
    });
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list when the answer has no predictions at all", async () => {
    mockAzure(() => json({}));
    const res = await POST(request(jpeg()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ detections: [] });
  });

  it("says to retry in a moment when a 429 does not say how long to wait", async () => {
    mockAzure(() => json({ error: { message: "slow down" } }, 429));
    const res = await POST(request(jpeg()));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeNull();
    expect((await res.json()).error).toEqual({
      code: "rate_limited",
      message: "Azure rate limit reached. Try again in a moment.",
    });
  });

  it.each([
    ["the flat message Azure sometimes uses", () => json({ message: "Bad image." }, 400), "Bad image."],
    ["the status text when the body is not JSON", () => new Response("<html>", { status: 400, statusText: "Bad Request" }), "Bad Request"],
  ])("explains a rejected image with %s", async (_, respond, reason) => {
    mockAzure(respond);
    const res = await POST(request(jpeg()));
    expect(res.status).toBe(422);
    expect((await res.json()).error.message).toContain(reason);
  });
});

describe("how long the wait is said to be", () => {
  afterEach(() => vi.useRealTimers());

  const exhaustVisitor = async () => {
    mockAzure();
    for (let i = 0; i < VISITOR_REQUESTS_PER_HOUR; i += 1) await POST(from("203.0.113.9:1"));
  };
  const refusal = async () => (await (await POST(from("203.0.113.9:1"))).json()).error.message as string;

  it("in minutes at first, in seconds for the last minute and a half", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-06T10:00:00Z"), toFake: ["Date"] });
    await exhaustVisitor();
    expect(await refusal()).toBe("This demo allows 10 photos per hour per visitor. Try again in 60 minutes.");
    vi.setSystemTime(new Date("2026-10-06T10:58:31Z"));
    expect(await refusal()).toBe("This demo allows 10 photos per hour per visitor. Try again in 89 seconds.");
  });

  it("in hours for the daily limit", async () => {
    mockAzure();
    let last = "";
    for (let i = 0; i <= TOTAL_REQUESTS_PER_DAY; i += 1) {
      last = (await (await POST(from(`198.51.100.${i % 250}:1`))).clone().text());
    }
    expect(JSON.parse(last).error.message).toBe("This demo has used up its analyses for today. Try again in 24 hours.");
  });
});
