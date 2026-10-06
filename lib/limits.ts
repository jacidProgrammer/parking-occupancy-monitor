// Limits of the Custom Vision prediction endpoint, which receives one tile per call.
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/bmp"] as const;

export const ACCEPTED_IMAGE_LABEL = "JPEG, PNG, GIF or BMP";

export function isAcceptedImageType(type: string): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type);
}

// The browser cuts the photo into JPEG tiles before uploading, so it can take any format
// it can decode and a file far larger than one prediction call allows.
export const PHOTO_TYPES = [...ACCEPTED_IMAGE_TYPES, "image/webp"];

export const PHOTO_TYPES_LABEL = "JPEG, PNG, GIF, BMP or WEBP";

export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

export function isPhotoType(type: string): boolean {
  return PHOTO_TYPES.includes(type);
}

/** Why this file cannot be analyzed, or null when it can. */
export function photoProblem(file: { type: string; size: number }): string | null {
  if (!isPhotoType(file.type)) return `Unsupported file type. Use ${PHOTO_TYPES_LABEL}.`;
  if (file.size > MAX_PHOTO_BYTES) return `Image is larger than ${MAX_PHOTO_BYTES / 1024 / 1024} MB.`;
  return null;
}
