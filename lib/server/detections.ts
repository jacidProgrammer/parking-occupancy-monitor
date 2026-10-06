import type { CustomVisionResponse, Detection, DetectionKind } from "../types";

// Measured on held-out aerial images: at 0.3 the model finds 86 % of cars and 82 % of free
// bays (74 % and 67 % at 0.5), while the portal reports 98 % precision at 0.3.
export const MIN_CONFIDENCE = 0.3;

const KINDS: readonly string[] = ["car", "free"] satisfies DetectionKind[];

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** Predictions the app uses, with boxes as 0–1 fractions of the analyzed image. */
export function toDetections(response: CustomVisionResponse): Detection[] {
  return (response.predictions ?? [])
    .filter((prediction) => KINDS.includes(prediction.tagName) && prediction.probability >= MIN_CONFIDENCE)
    .map((prediction) => {
      const x = clamp(prediction.boundingBox.left);
      const y = clamp(prediction.boundingBox.top);
      return {
        kind: prediction.tagName as DetectionKind,
        confidence: prediction.probability,
        box: {
          x,
          y,
          // What is left of the box after clipping it to the image.
          w: Math.max(0, Math.min(prediction.boundingBox.width - (x - prediction.boundingBox.left), 1 - x)),
          h: Math.max(0, Math.min(prediction.boundingBox.height - (y - prediction.boundingBox.top), 1 - y)),
        },
      };
    });
}
