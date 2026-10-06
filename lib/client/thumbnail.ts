const THUMBNAIL_WIDTH = 160;

/** Small JPEG data URL of an image, or undefined if the browser can't decode it. */
export async function makeThumbnail(src: string): Promise<string | undefined> {
  try {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = THUMBNAIL_WIDTH;
    canvas.height = Math.max(1, Math.round((image.naturalHeight / image.naturalWidth) * THUMBNAIL_WIDTH));
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.6);
  } catch {
    return undefined;
  }
}
