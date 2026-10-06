/** A rectangle. Whether it is in pixels or in 0–1 fractions is stated where it is used. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the model was trained to find: a parked car, or a marked bay with nothing in it. */
export type DetectionKind = "car" | "free";

export interface Detection {
  kind: DetectionKind;
  confidence: number;
  box: Box;
}

/** Response of POST /api/analyze-parking for one image tile; boxes are fractions of that tile. */
export interface AnalyzeTileResponse {
  detections: Detection[];
}

/** A whole photo once its tiles are merged; boxes are pixels of the photo. */
export interface ParkingAnalysis {
  width: number;
  height: number;
  detections: Detection[];
  cars: number;
  free: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; retryAfterSeconds?: number };
}

/** Subset of the Custom Vision prediction response this app reads. */
export interface CustomVisionPrediction {
  probability: number;
  tagName: string;
  boundingBox: { left: number; top: number; width: number; height: number };
}

export interface CustomVisionResponse {
  predictions?: CustomVisionPrediction[];
}
