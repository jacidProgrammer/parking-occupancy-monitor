import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Runs the real command, in a folder of its own, against a stand-in for the training API.
const SCRIPT = fileURLToPath(new URL("../scripts/import-dataset.mjs", import.meta.url));

interface Received {
  method: string;
  url: string;
  key: string | undefined;
  body: { images?: { name: string; contents: string; regions: { tagId: string }[] }[] } | null;
}

let cwd: string;
let server: Server;
let received: Received[];
let endpoint: string;

const read = (request: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let text = "";
    request.on("data", (part) => (text += part));
    request.on("end", () => resolve(text));
  });

beforeEach(async () => {
  cwd = mkdtempSync(join(tmpdir(), "parking-import-"));
  mkdirSync(join(cwd, "data", "train"), { recursive: true });
  writeFileSync(
    join(cwd, "data", "train", "_annotations.coco.json"),
    JSON.stringify({
      categories: [{ id: 1, name: "car" }, { id: 2, name: "free" }, { id: 3, name: "person" }],
      images: [
        { id: 1, file_name: "istock-1.jpg", width: 100, height: 100 },
        { id: 2, file_name: "istock-2.jpg", width: 100, height: 100 },
        { id: 3, file_name: "garage-1.jpg", width: 100, height: 100 },
      ],
      annotations: [
        { image_id: 1, category_id: 1, bbox: [25, 25, 50, 50] },
        { image_id: 1, category_id: 2, bbox: [50, 25, 25, 50] },
        { image_id: 2, category_id: 1, bbox: [0, 0, 50, 50] },
        { image_id: 3, category_id: 1, bbox: [0, 0, 50, 50] },
        { image_id: 3, category_id: 3, bbox: [0, 0, 10, 10] },
      ],
    }),
  );
  for (const name of ["istock-1.jpg", "istock-2.jpg", "garage-1.jpg"]) {
    writeFileSync(join(cwd, "data", "train", name), `bytes of ${name}`);
  }

  received = [];
  server = createServer(async (request, response) => {
    const text = await read(request);
    received.push({
      method: request.method!,
      url: request.url!,
      key: request.headers["training-key"] as string | undefined,
      body: text ? JSON.parse(text) : null,
    });
    const answer = request.url!.endsWith("/tags")
      ? [{ name: "car", id: "id-car" }]
      : request.url!.includes("/tags?name=")
        ? { id: "id-free" }
        : { images: received.at(-1)!.body!.images!.map(() => ({ status: "OK" })) };
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(answer));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(cwd, { recursive: true, force: true });
});

function run(args: string[], settings: Record<string, string> = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(
      process.execPath,
      [SCRIPT, ...args],
      { cwd, env: { NODE_ENV: "test", PATH: process.env.PATH, ...settings } },
      (error, stdout, stderr) => resolve({ code: error ? Number(error.code) : 0, stdout, stderr }),
    );
  });
}

const settings = () => ({
  AZURE_CUSTOM_VISION_TRAINING_ENDPOINT: `${endpoint}/`,
  AZURE_CUSTOM_VISION_TRAINING_KEY: "training-key",
  AZURE_CUSTOM_VISION_PROJECT_ID: "p1",
});
const API = "/customvision/v3.3/Training/projects/p1";

describe("import-dataset.mjs", () => {
  it("fails when the folder holds no dataset", async () => {
    const missing = await run(["--dir", "."], settings());
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("No _annotations.coco.json found in . or its subfolders.");
    expect(received).toEqual([]);
  });

  it("without --map lists the classes and uploads nothing", async () => {
    const result = await run(["--dir", "data"], settings());
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("images: 3");
    expect(result.stdout).toContain('boxes per class: {"car":3,"free":1,"person":1}');
    expect(result.stdout).toContain("Pass --map <category>=<tag>");
    expect(result.stdout).not.toContain("to upload:");
    expect(received).toEqual([]);
  });

  it("with --map but without --upload only reports, even with the settings in place", async () => {
    const result = await run(["--dir", "data", "--map", "car=car,free=free", "--include", "^istock"], settings());
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("images matching --include: 2");
    expect(result.stdout).toContain("to upload: 2 images, 3 boxes (max 2 in one image)");
    expect(result.stdout).toContain("Total to upload: 2 images.");
    expect(result.stdout).toContain("Report only. Add --upload to send them to Custom Vision.");
    expect(received).toEqual([]);
  });

  it("refuses to upload without the three settings", async () => {
    const result = await run(["--dir", "data", "--map", "car=car", "--upload"], { ...settings(), AZURE_CUSTOM_VISION_TRAINING_KEY: "" });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Set AZURE_CUSTOM_VISION_TRAINING_ENDPOINT, AZURE_CUSTOM_VISION_TRAINING_KEY and AZURE_CUSTOM_VISION_PROJECT_ID in .env.local.");
    expect(received).toEqual([]);
  });

  it("uploads the matching images with their boxes, creating only the missing tag", async () => {
    const result = await run(["--dir", "data", "--map", "car=car,free=free", "--include", "^istock", "--upload"], settings());
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Upload result by status: {"OK":2}');

    expect(received.map(({ method, url }) => `${method} ${url}`)).toEqual([
      `GET ${API}/tags`,
      `POST ${API}/tags?name=free`,
      `POST ${API}/images/files`,
    ]);
    expect(received.every(({ key }) => key === "training-key")).toBe(true);
    const images = received[2].body!.images!;
    expect(images.map((image) => image.name)).toEqual(["istock-1.jpg", "istock-2.jpg"]);
    expect(Buffer.from(images[0].contents, "base64").toString()).toBe("bytes of istock-1.jpg");
    expect(images[0].regions).toEqual([
      { tagId: "id-car", left: 0.25, top: 0.25, width: 0.5, height: 0.5 },
      { tagId: "id-free", left: 0.5, top: 0.25, width: 0.25, height: 0.5 },
    ]);
  });

  it("reads the settings from .env.local and honours --limit", async () => {
    writeFileSync(join(cwd, ".env.local"), Object.entries(settings()).map(([name, value]) => `${name}=${value}`).join("\n"));
    const result = await run(["--dir", "data", "--map", "car=car", "--limit", "1", "--upload"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Total to upload: 1 images.");
    expect(received.at(-1)!.body!.images!.map((image) => image.name)).toEqual(["istock-1.jpg"]);
  });
});
