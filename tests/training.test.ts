import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANNOTATIONS,
  applyEnvFile,
  BATCH_SIZE,
  createClient,
  ensureTags,
  filterImages,
  findSplits,
  parseArgs,
  trainingConfig,
  uploadImages,
} from "../scripts/lib/training.mjs";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const config = { endpoint: "https://train.example", key: "training-key", projectId: "p1" };
const quiet = { sleep: vi.fn().mockResolvedValue(undefined), log: vi.fn() };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "parking-dataset-"));
  quiet.sleep.mockClear();
  quiet.log.mockClear();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("parseArgs", () => {
  it("only reports by default", () => {
    expect(parseArgs([])).toEqual({ dir: "dataset", map: {}, include: null, limit: Infinity, upload: false });
  });

  it("reads every option", () => {
    const args = parseArgs(["--dir", "data/train", "--map", "car=car,empty=free", "--include", "^istock", "--limit", "5", "--upload"]);
    expect(args).toMatchObject({ dir: "data/train", map: { car: "car", empty: "free" }, limit: 5, upload: true });
    const include = args.include as RegExp | null;
    expect(include?.test("istock-1.jpg")).toBe(true);
    expect(include?.test("garage-1.jpg")).toBe(false);
  });

  it("refuses a malformed --map and an unknown argument", () => {
    expect(() => parseArgs(["--map", "car"])).toThrow('--map expects category=tag pairs, got "car"');
    expect(() => parseArgs(["--map", "=free"])).toThrow("--map expects");
    expect(() => parseArgs(["--uplaod"])).toThrow("Unknown argument --uplaod");
  });
});

describe("applyEnvFile and trainingConfig", () => {
  it("reads KEY=value lines, ignores the rest and does not override what is already set", () => {
    const env: Record<string, string | undefined> = { AZURE_CUSTOM_VISION_PROJECT_ID: "from-shell" };
    applyEnvFile("# comment\nAZURE_CUSTOM_VISION_TRAINING_KEY= abc \nAZURE_CUSTOM_VISION_PROJECT_ID=from-file\nnot a line\n", env);
    expect(env).toEqual({ AZURE_CUSTOM_VISION_TRAINING_KEY: "abc", AZURE_CUSTOM_VISION_PROJECT_ID: "from-shell" });
  });

  it("needs the three settings and drops the trailing slash of the endpoint", () => {
    const env = {
      AZURE_CUSTOM_VISION_TRAINING_ENDPOINT: " https://train.example// ",
      AZURE_CUSTOM_VISION_TRAINING_KEY: "k",
      AZURE_CUSTOM_VISION_PROJECT_ID: "p1",
    };
    expect(trainingConfig(env)).toEqual({ endpoint: "https://train.example", key: "k", projectId: "p1" });
    for (const missing of Object.keys(env)) expect(trainingConfig({ ...env, [missing]: " " })).toBeNull();
  });
});

describe("findSplits", () => {
  it("finds the folder itself and its subfolders that hold annotations, and no others", () => {
    for (const name of ["train", "valid", "notes"]) mkdirSync(join(dir, name));
    writeFileSync(join(dir, "train", ANNOTATIONS), "{}");
    writeFileSync(join(dir, "valid", ANNOTATIONS), "{}");
    expect(findSplits(dir)).toEqual([join(dir, "train"), join(dir, "valid")]);
    expect(findSplits(join(dir, "train"))).toEqual([join(dir, "train")]);
    expect(findSplits(join(dir, "notes"))).toEqual([]);
  });
});

describe("filterImages", () => {
  const coco = {
    categories: [{ id: 1, name: "car" }],
    images: [{ id: 1, file_name: "istock-1.jpg" }, { id: 2, file_name: "garage-1.jpg" }],
    annotations: [{ image_id: 1, category_id: 1 }, { image_id: 2, category_id: 1 }, { image_id: 2, category_id: 1 }],
  };

  it("keeps matching images and only their annotations", () => {
    const filtered = filterImages(coco, /^istock/);
    expect(filtered.images.map((image: { id: number }) => image.id)).toEqual([1]);
    expect(filtered.annotations).toEqual([{ image_id: 1, category_id: 1 }]);
    expect(filtered.categories).toBe(coco.categories);
  });

  it("changes nothing without a filter", () => {
    expect(filterImages(coco, null)).toBe(coco);
  });
});

describe("createClient", () => {
  it("calls the project's training API with the key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, [{ id: "t1" }]));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createClient(config, quiet)("POST", "images/files", { images: [] })).resolves.toEqual([{ id: "t1" }]);
    expect(fetchMock).toHaveBeenCalledWith("https://train.example/customvision/v3.3/Training/projects/p1/images/files", {
      method: "POST",
      headers: { "Training-Key": "training-key", "Content-Type": "application/json" },
      body: '{"images":[]}',
    });
  });

  it("sends no body on a GET", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, []));
    vi.stubGlobal("fetch", fetchMock);
    await createClient(config, quiet)("GET", "tags");
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined();
  });

  it("waits what a rate limit asks, or 5 seconds, and retries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(json(429, {}, { "Retry-After": "2" }))
        .mockResolvedValueOnce(json(429, {}))
        .mockResolvedValueOnce(json(200, { ok: true })),
    );
    await expect(createClient(config, quiet)("GET", "tags")).resolves.toEqual({ ok: true });
    expect(quiet.sleep.mock.calls).toEqual([[2000], [5000]]);
    expect(quiet.log).toHaveBeenCalledWith("  rate limited, waiting 2s");
  });

  it("really waits before retrying when left to its own clock", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockResolvedValueOnce(json(429, {}, { "Retry-After": "3" })).mockResolvedValueOnce(json(200, []));
      vi.stubGlobal("fetch", fetchMock);
      const result = createClient(config, { log: quiet.log })("GET", "tags");
      await vi.advanceTimersByTimeAsync(2999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up after five retries", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => json(429, { message: "slow down" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(createClient(config, quiet)("GET", "tags")).rejects.toThrow("GET tags → HTTP 429");
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(quiet.sleep).toHaveBeenCalledTimes(5);
  });

  it("fails with the status and the start of the answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(400), { status: 401 })));
    const error = await createClient(config, quiet)("GET", "tags").catch((cause: Error) => cause);
    expect((error as Error).message).toBe(`GET tags → HTTP 401: ${"x".repeat(300)}`);
  });
});

describe("ensureTags", () => {
  it("reuses the tags the project has and creates only the missing ones", async () => {
    const call = vi.fn(async (method: string, path: string) =>
      method === "GET" ? [{ name: "car", id: "id-car" }] : { id: `id-${path}` },
    );
    await expect(ensureTags(call, ["car", "free bay"])).resolves.toEqual({ car: "id-car", "free bay": "id-tags?name=free%20bay" });
    expect(call.mock.calls).toEqual([["GET", "tags"], ["POST", "tags?name=free%20bay"]]);
  });
});

describe("uploadImages", () => {
  const image = (n: number) => ({
    fileName: `${n}.jpg`,
    regions: [{ tag: "car", left: 0.1, top: 0.2, width: 0.3, height: 0.4 }],
  });

  it("sends each folder in batches of 64 with the image bytes and tag ids, and counts the statuses", async () => {
    const images = Array.from({ length: BATCH_SIZE + 1 }, (_, n) => image(n));
    for (const { fileName } of images) writeFileSync(join(dir, fileName), `bytes of ${fileName}`);
    const call = vi.fn(async (_method: string, _path: string, body: { images: { name: string }[] }) => ({
      images: body.images.map(({ name }) => ({ status: name === "0.jpg" ? "OKDuplicate" : "OK" })),
    }));

    const statuses = await uploadImages(call, [{ folder: dir, images }], { car: "id-car" }, quiet);

    expect(statuses).toEqual({ OK: BATCH_SIZE, OKDuplicate: 1 });
    expect(call.mock.calls.map(([method, path, body]) => [method, path, body.images.length])).toEqual([
      ["POST", "images/files", BATCH_SIZE],
      ["POST", "images/files", 1],
    ]);
    expect(call.mock.calls[0][2].images[0]).toEqual({
      name: "0.jpg",
      contents: Buffer.from("bytes of 0.jpg").toString("base64"),
      regions: [{ tagId: "id-car", left: 0.1, top: 0.2, width: 0.3, height: 0.4 }],
    });
    expect(quiet.log.mock.calls).toEqual([[`  ${dir}: 64/65`], [`  ${dir}: 65/65`]]);
  });

  it("uploads nothing for an empty folder and survives an answer without images", async () => {
    writeFileSync(join(dir, "0.jpg"), "x");
    const call = vi.fn().mockResolvedValue({});
    await expect(uploadImages(call, [{ folder: dir, images: [] }, { folder: dir, images: [image(0)] }], {}, quiet)).resolves.toEqual({});
    expect(call).toHaveBeenCalledTimes(1);
  });
});
