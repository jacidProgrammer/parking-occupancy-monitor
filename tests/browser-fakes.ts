import { vi } from "vitest";

/** jsdom has neither image decoding nor a canvas: these stand in for both. */
export function fakeImage({ width = 1981, height = 2000, decodes = true } = {}) {
  class FakeImage {
    naturalWidth = width;
    naturalHeight = height;
    onload: (() => void) | null = null;
    private current = "";
    get src() {
      return this.current;
    }
    set src(value: string) {
      this.current = value;
      if (decodes) queueMicrotask(() => this.onload?.());
    }
    decode() {
      return decodes ? Promise.resolve() : Promise.reject(new Error("cannot decode"));
    }
  }
  vi.stubGlobal("Image", FakeImage);
}

export function fakeCanvas({ context = true, blob = true } = {}) {
  const drawImage = vi.fn();
  /** Boxes painted on the canvas, with the colours in force when each was drawn. */
  const boxes: { stroke: string; fill: string; rect: number[] }[] = [];
  const drawing = {
    lineWidth: 0,
    fillStyle: "",
    strokeStyle: "",
    fillRect: vi.fn(),
    strokeRect(...rect: number[]) {
      boxes.push({ stroke: this.strokeStyle, fill: this.fillStyle, rect });
    },
  };
  const sizes: { width: number; height: number }[] = [];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    sizes.push({ width: this.width, height: this.height });
    return (context ? Object.assign(drawing, { drawImage }) : null) as unknown as CanvasRenderingContext2D;
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback, type) =>
    callback(blob ? new Blob(["tile"], { type }) : null),
  );
  const toDataURL = vi
    .spyOn(HTMLCanvasElement.prototype, "toDataURL")
    .mockReturnValue("data:image/jpeg;base64,thumb");
  return { drawImage, sizes, toDataURL, boxes, drawing };
}

/** jsdom cannot make object URLs. Returns the spies so a test can see what was released. */
export function fakeObjectUrls() {
  let next = 0;
  const create = vi.fn(() => `blob:photo-${(next += 1)}`);
  const revoke = vi.fn();
  URL.createObjectURL = create;
  URL.revokeObjectURL = revoke;
  return { create, revoke };
}
