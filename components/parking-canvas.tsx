"use client";

import { useEffect, useRef } from "react";
import type { DetectionKind, ParkingAnalysis } from "@/lib/types";

export const KIND_STYLE: Record<DetectionKind, { label: string; stroke: string; fill: string }> = {
  car: { label: "cars", stroke: "#2563eb", fill: "rgba(37, 99, 235, 0.18)" },
  free: { label: "free bays", stroke: "#16a34a", fill: "rgba(22, 163, 74, 0.18)" },
};

function drawDetections(
  ctx: CanvasRenderingContext2D,
  analysis: ParkingAnalysis,
  canvasWidth: number,
  canvasHeight: number,
) {
  if (analysis.width <= 0 || analysis.height <= 0) return;
  // Boxes are in the pixels the photo was analyzed at; scale in case the canvas differs.
  const scaleX = canvasWidth / analysis.width;
  const scaleY = canvasHeight / analysis.height;
  ctx.lineWidth = Math.max(2, Math.max(canvasWidth, canvasHeight) / 400);
  for (const detection of analysis.detections) {
    const style = KIND_STYLE[detection.kind];
    const x = detection.box.x * scaleX;
    const y = detection.box.y * scaleY;
    const w = detection.box.w * scaleX;
    const h = detection.box.h * scaleY;
    ctx.fillStyle = style.fill;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = style.stroke;
    ctx.strokeRect(x, y, w, h);
  }
}

export function ParkingCanvas({
  src,
  analysis,
}: {
  src: string;
  analysis: ParkingAnalysis | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (cancelled || !canvas || !ctx) return;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      ctx.drawImage(image, 0, 0);
      if (analysis) drawDetections(ctx, analysis, canvas.width, canvas.height);
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src, analysis]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={
        analysis
          ? `Uploaded photo with ${analysis.cars} cars and ${analysis.free} free bays outlined`
          : "Uploaded photo"
      }
      className="block h-auto w-full rounded-lg bg-muted"
    />
  );
}
