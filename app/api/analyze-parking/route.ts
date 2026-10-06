import { checkRateLimit } from "@/lib/server/request-guard";
import { detectParking, VisionError } from "@/lib/server/custom-vision";
import { ACCEPTED_IMAGE_LABEL, isAcceptedImageType, MAX_IMAGE_BYTES } from "@/lib/limits";
import type { AnalyzeTileResponse, ApiErrorBody } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(
  status: number,
  code: string,
  message: string,
  retryAfterSeconds?: number,
): Response {
  const body: ApiErrorBody = { error: { code, message, retryAfterSeconds } };
  return Response.json(body, {
    status,
    headers: retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : undefined,
  });
}

// Room for the multipart envelope around a file of the maximum size.
const MAX_BODY_BYTES = MAX_IMAGE_BYTES + 64 * 1024;

export async function POST(request: Request): Promise<Response> {
  const limit = checkRateLimit(request);
  if (!limit.ok) return fail(429, limit.code, limit.message, limit.retryAfterSeconds);

  // Refuse an oversized upload from its declared length, before reading it into memory.
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    return fail(413, "file_too_large", `Image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "invalid_request", "Send the image as multipart/form-data in an 'image' field.");
  }

  const file = form.get("image");
  if (!(file instanceof File)) {
    return fail(400, "missing_file", "No image received. Send it in the 'image' form field.");
  }
  if (!isAcceptedImageType(file.type)) {
    return fail(415, "unsupported_type", `Unsupported file type. Use ${ACCEPTED_IMAGE_LABEL}.`);
  }
  if (file.size === 0) {
    return fail(400, "empty_file", "The file is empty.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return fail(413, "file_too_large", `Image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
  }

  try {
    const body: AnalyzeTileResponse = { detections: await detectParking(await file.arrayBuffer()) };
    return Response.json(body);
  } catch (error) {
    if (error instanceof VisionError) {
      return fail(error.httpStatus, error.code, error.message, error.retryAfterSeconds);
    }
    console.error("analyze-parking failed", error);
    return fail(500, "internal_error", "Unexpected error while analyzing the image.");
  }
}
