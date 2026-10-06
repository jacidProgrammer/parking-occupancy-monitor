"use client";

import { useRef, useState } from "react";
import { ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_PHOTO_BYTES, PHOTO_TYPES, PHOTO_TYPES_LABEL } from "@/lib/limits";
import { cn } from "@/lib/utils";

export function UploadDropzone({
  onFile,
  disabled,
  disabledHint,
}: {
  onFile: (file: File) => void;
  disabled: boolean;
  disabledHint: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (!disabled && file) onFile(file);
      }}
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
        dragging ? "border-primary bg-muted" : "border-border",
        disabled && "opacity-60",
      )}
    >
      <ImagePlus className="h-8 w-8 text-muted-foreground" aria-hidden />
      <div>
        <p className="font-medium">Drop an aerial parking lot photo here</p>
        <p className="text-sm text-muted-foreground">
          {disabled
            ? disabledHint
            : `${PHOTO_TYPES_LABEL} · up to ${MAX_PHOTO_BYTES / 1024 / 1024} MB`}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        Browse files
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={PHOTO_TYPES.join(",")}
        disabled={disabled}
        className="sr-only"
        aria-label="Upload parking lot photo"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onFile(file);
          event.target.value = "";
        }}
      />
    </div>
  );
}
