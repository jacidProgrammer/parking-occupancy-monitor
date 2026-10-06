// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { makeThumbnail } from "@/lib/client/thumbnail";
import { fakeCanvas, fakeImage } from "./browser-fakes";

describe("makeThumbnail", () => {
  it("draws the photo 160 px wide, keeping its proportions, as a JPEG", async () => {
    fakeImage({ width: 2000, height: 1000 });
    const { drawImage, sizes, toDataURL } = fakeCanvas();
    await expect(makeThumbnail("blob:photo")).resolves.toBe("data:image/jpeg;base64,thumb");
    expect(sizes).toEqual([{ width: 160, height: 80 }]);
    expect(drawImage.mock.calls[0].slice(1)).toEqual([0, 0, 160, 80]);
    expect(toDataURL).toHaveBeenCalledWith("image/jpeg", 0.6);
  });

  it("is at least one pixel tall for a very wide photo", async () => {
    fakeImage({ width: 10000, height: 10 });
    const { sizes } = fakeCanvas();
    await makeThumbnail("blob:photo");
    expect(sizes[0].height).toBe(1);
  });

  it("is undefined when the image cannot be decoded or there is no canvas", async () => {
    fakeImage({ decodes: false });
    fakeCanvas();
    await expect(makeThumbnail("blob:photo")).resolves.toBeUndefined();
    fakeImage();
    fakeCanvas({ context: false });
    await expect(makeThumbnail("blob:photo")).resolves.toBeUndefined();
  });
});
