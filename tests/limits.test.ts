import { describe, expect, it } from "vitest";
import { MAX_PHOTO_BYTES, photoProblem } from "@/lib/limits";

describe("photoProblem", () => {
  it("accepts a photo of a supported type within the size limit", () => {
    expect(photoProblem({ type: "image/webp", size: MAX_PHOTO_BYTES })).toBeNull();
  });

  it("names the supported formats when the type is not one of them", () => {
    expect(photoProblem({ type: "image/heic", size: 10 })).toBe(
      "Unsupported file type. Use JPEG, PNG, GIF, BMP or WEBP.",
    );
  });

  it("names the limit when the photo is one byte over it", () => {
    expect(photoProblem({ type: "image/jpeg", size: MAX_PHOTO_BYTES + 1 })).toBe("Image is larger than 25 MB.");
  });
});
