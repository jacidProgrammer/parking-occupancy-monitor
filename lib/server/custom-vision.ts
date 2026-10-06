import { toDetections } from "./detections";
import type { CustomVisionResponse, Detection } from "../types";

const TIMEOUT_MS = 20_000;

export class VisionError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "VisionError";
  }
}

function getConfig() {
  const url = process.env.AZURE_CUSTOM_VISION_PREDICTION_URL?.trim();
  const key = process.env.AZURE_CUSTOM_VISION_PREDICTION_KEY?.trim();
  if (!url || !key) {
    throw new VisionError(
      "not_configured",
      503,
      "The Custom Vision model is not configured. Set AZURE_CUSTOM_VISION_PREDICTION_URL and AZURE_CUSTOM_VISION_PREDICTION_KEY (in .env.local, or in the host's application settings) and restart the server.",
    );
  }
  return { url, key };
}

async function azureMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.error?.message ?? body?.message ?? res.statusText;
  } catch {
    return res.statusText;
  }
}

async function toVisionError(res: Response): Promise<VisionError> {
  const message = await azureMessage(res);
  switch (res.status) {
    case 401:
    case 403:
      return new VisionError(
        "azure_auth",
        502,
        "Azure rejected the credentials. Check that AZURE_CUSTOM_VISION_PREDICTION_KEY is the prediction key of the resource in AZURE_CUSTOM_VISION_PREDICTION_URL.",
      );
    case 404:
      return new VisionError(
        "azure_endpoint",
        502,
        "Model not found. Check AZURE_CUSTOM_VISION_PREDICTION_URL and that the iteration it names is still published.",
      );
    case 429: {
      const retryAfter = Number(res.headers.get("Retry-After"));
      const seconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
      return new VisionError(
        "rate_limited",
        429,
        seconds
          ? `Azure rate limit reached. Try again in ${seconds}s.`
          : "Azure rate limit reached. Try again in a moment.",
        seconds,
      );
    }
    case 400:
      return new VisionError("invalid_image", 422, `Azure could not process this image: ${message}`);
    default:
      return new VisionError("azure_error", 502, `Azure returned ${res.status}: ${message}`);
  }
}

async function callAzure<T>(url: string, key: string, image: ArrayBuffer): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Prediction-Key": key,
        "Content-Type": "application/octet-stream",
      },
      body: image,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "TimeoutError") {
      throw new VisionError("azure_timeout", 504, "Azure did not respond in time. Try again.");
    }
    throw new VisionError("azure_unreachable", 502, "Could not reach Azure. Check AZURE_CUSTOM_VISION_PREDICTION_URL.");
  }
  if (!res.ok) throw await toVisionError(res);
  return (await res.json()) as T;
}

/** Cars and free bays in one image, with boxes as fractions of it. */
export async function detectParking(image: ArrayBuffer): Promise<Detection[]> {
  const { url, key } = getConfig();
  return toDetections(await callAzure<CustomVisionResponse>(url, key, image));
}
