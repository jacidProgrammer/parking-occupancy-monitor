// COCO → Custom Vision. COCO boxes are [x, y, width, height] in pixels;
// Custom Vision regions are left/top/width/height as fractions of the image.

export const MAX_REGIONS_PER_IMAGE = 300;

const clamp = (value) => Math.min(1, Math.max(0, value));

/** One Custom Vision region, or null when the box has no area inside the image. */
export function toRegion(bbox, imageWidth, imageHeight) {
  const [x, y, w, h] = bbox;
  const left = clamp(x / imageWidth);
  const top = clamp(y / imageHeight);
  const right = clamp((x + w) / imageWidth);
  const bottom = clamp((y + h) / imageHeight);
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Groups a COCO file by image. `classMap` maps COCO category name → Custom Vision
 * tag name; categories missing from it are dropped.
 */
export function toLabelledImages(coco, classMap) {
  const tagByCategory = new Map();
  for (const category of coco.categories ?? []) {
    const tag = classMap[category.name];
    if (tag) tagByCategory.set(category.id, tag);
  }
  const byImage = new Map();
  for (const image of coco.images ?? []) {
    byImage.set(image.id, { fileName: image.file_name, width: image.width, height: image.height, regions: [] });
  }
  let droppedBoxes = 0;
  for (const annotation of coco.annotations ?? []) {
    const image = byImage.get(annotation.image_id);
    const tag = tagByCategory.get(annotation.category_id);
    if (!image || !tag) continue;
    const region = toRegion(annotation.bbox, image.width, image.height);
    if (region) image.regions.push({ tag, ...region });
    else droppedBoxes += 1;
  }
  const all = [...byImage.values()];
  return {
    images: all.filter((image) => image.regions.length > 0 && image.regions.length <= MAX_REGIONS_PER_IMAGE),
    unlabelled: all.filter((image) => image.regions.length === 0).length,
    tooManyRegions: all.filter((image) => image.regions.length > MAX_REGIONS_PER_IMAGE).length,
    droppedBoxes,
  };
}

/** Annotation count per category name, including categories with none. */
export function countByCategory(coco) {
  const names = new Map((coco.categories ?? []).map((category) => [category.id, category.name]));
  const counts = Object.fromEntries([...names.values()].map((name) => [name, 0]));
  for (const annotation of coco.annotations ?? []) {
    const name = names.get(annotation.category_id);
    if (name !== undefined) counts[name] += 1;
  }
  return counts;
}
