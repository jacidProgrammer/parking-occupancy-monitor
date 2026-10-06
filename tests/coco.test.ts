import { describe, expect, it } from "vitest";
import { countByCategory, MAX_REGIONS_PER_IMAGE, toLabelledImages, toRegion } from "../scripts/lib/coco.mjs";

const coco = {
  // Roboflow exports add the dataset name as category 0, with no annotations.
  categories: [
    { id: 0, name: "parking-lot" },
    { id: 1, name: "car" },
    { id: 2, name: "free" },
  ],
  images: [
    { id: 10, file_name: "a.jpg", width: 640, height: 320 },
    { id: 11, file_name: "b.jpg", width: 640, height: 320 },
    { id: 12, file_name: "c.jpg", width: 640, height: 320 },
  ],
  annotations: [
    { image_id: 10, category_id: 1, bbox: [80, 40, 160, 80] },
    { image_id: 10, category_id: 2, bbox: [320, 160, 160, 80] },
    { image_id: 11, category_id: 2, bbox: [0, 0, 64, 32] },
    { image_id: 10, category_id: 1, bbox: [700, 10, 20, 20] },
    { image_id: 99, category_id: 1, bbox: [0, 0, 10, 10] },
  ],
};

describe("toRegion", () => {
  it("normalizes pixels to fractions of the image", () => {
    expect(toRegion([80, 40, 160, 80], 640, 320)).toEqual({ left: 0.125, top: 0.125, width: 0.25, height: 0.25 });
  });

  it("clips a box that sticks out of the image", () => {
    expect(toRegion([600, 300, 80, 40], 640, 320)).toEqual({
      left: 0.9375,
      top: 0.9375,
      width: 0.0625,
      height: 0.0625,
    });
    expect(toRegion([-32, -16, 64, 32], 640, 320)).toEqual({ left: 0, top: 0, width: 0.05, height: 0.05 });
  });

  it.each([
    [[700, 10, 20, 20]],
    [[10, 10, 0, 20]],
    [[10, 10, 20, -5]],
  ])("drops %j: no area inside the image", (bbox) => expect(toRegion(bbox, 640, 320)).toBeNull());
});

describe("toLabelledImages", () => {
  it("maps categories to tags and groups regions by image", () => {
    const result = toLabelledImages(coco, { car: "occupied", free: "empty" });
    expect(result.images.map((image) => image.fileName)).toEqual(["a.jpg", "b.jpg"]);
    expect(result.images[0].regions).toEqual([
      { tag: "occupied", left: 0.125, top: 0.125, width: 0.25, height: 0.25 },
      { tag: "empty", left: 0.5, top: 0.5, width: 0.25, height: 0.25 },
    ]);
    expect(result.unlabelled).toBe(1);
    expect(result.droppedBoxes).toBe(1);
    expect(result.tooManyRegions).toBe(0);
  });

  it("drops categories that are not in the class map", () => {
    const result = toLabelledImages(coco, { car: "occupied" });
    expect(result.images.map((image) => image.fileName)).toEqual(["a.jpg"]);
    expect(result.images[0].regions).toHaveLength(1);
    expect(result.unlabelled).toBe(2);
  });

  it("leaves out an image over Custom Vision's region limit and counts it", () => {
    const crowded = {
      categories: [{ id: 1, name: "car" }],
      images: [{ id: 1, file_name: "crowded.jpg", width: 1000, height: 1000 }],
      annotations: Array.from({ length: MAX_REGIONS_PER_IMAGE + 1 }, (_, i) => ({
        image_id: 1,
        category_id: 1,
        bbox: [i, i, 10, 10],
      })),
    };
    const result = toLabelledImages(crowded, { car: "occupied" });
    expect(result.images).toEqual([]);
    expect(result.tooManyRegions).toBe(1);
  });
});

describe("countByCategory", () => {
  it("counts annotations per class and shows the empty ones", () => {
    expect(countByCategory(coco)).toEqual({ "parking-lot": 0, car: 3, free: 2 });
  });
});

describe("an annotations file with parts missing", () => {
  it("is an empty dataset, not a crash", () => {
    expect(toLabelledImages({}, { car: "car" })).toMatchObject({ images: [], unlabelled: 0, tooManyRegions: 0, droppedBoxes: 0 });
    expect(countByCategory({})).toEqual({});
  });

  it("ignores annotations that point at an unknown image or category", () => {
    const coco = {
      categories: [{ id: 1, name: "car" }],
      images: [{ id: 1, file_name: "a.jpg", width: 100, height: 100 }],
      annotations: [
        { image_id: 1, category_id: 1, bbox: [10, 10, 20, 20] },
        { image_id: 99, category_id: 1, bbox: [10, 10, 20, 20] },
        { image_id: 1, category_id: 99, bbox: [10, 10, 20, 20] },
      ],
    };
    expect(toLabelledImages(coco, { car: "car" }).images[0].regions).toHaveLength(1);
    expect(countByCategory(coco)).toEqual({ car: 2 });
  });
});
