// The parts of import-dataset.mjs that decide something: arguments, which folders hold a
// dataset, and the calls to the Custom Vision training API.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ANNOTATIONS = "_annotations.coco.json";
export const BATCH_SIZE = 64; // Custom Vision's limit per upload call.
const API = "customvision/v3.3/Training";
const MAX_RETRIES = 5;

export function parseArgs(argv) {
  const args = { dir: "dataset", map: {}, include: null, limit: Infinity, upload: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir") args.dir = argv[++i];
    else if (argv[i] === "--upload") args.upload = true;
    else if (argv[i] === "--limit") args.limit = Number(argv[++i]);
    else if (argv[i] === "--include") args.include = new RegExp(argv[++i]);
    else if (argv[i] === "--map") {
      for (const pair of argv[++i].split(",")) {
        const [from, to] = pair.split("=");
        if (!from || !to) throw new Error(`--map expects category=tag pairs, got "${pair}"`);
        args.map[from] = to;
      }
    } else throw new Error(`Unknown argument ${argv[i]}`);
  }
  return args;
}

/** KEY=value lines of an env file. Variables already set in `env` win. */
export function applyEnvFile(text, env) {
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match && env[match[1]] === undefined) env[match[1]] = match[2].trim();
  }
}

/** Training endpoint, key and project from the environment, or null if any is missing. */
export function trainingConfig(env) {
  const config = {
    endpoint: env.AZURE_CUSTOM_VISION_TRAINING_ENDPOINT?.trim().replace(/\/+$/, ""),
    key: env.AZURE_CUSTOM_VISION_TRAINING_KEY?.trim(),
    projectId: env.AZURE_CUSTOM_VISION_PROJECT_ID?.trim(),
  };
  return config.endpoint && config.key && config.projectId ? config : null;
}

/** Folders under `dir` (or `dir` itself) that hold a COCO annotations file. */
export function findSplits(dir) {
  const subfolders = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(dir, entry.name));
  return [dir, ...subfolders].filter((folder) => existsSync(join(folder, ANNOTATIONS)));
}

/** Keeps only the images whose file name matches, and their annotations. */
export function filterImages(coco, include) {
  if (!include) return coco;
  const images = coco.images.filter((image) => include.test(image.file_name));
  const kept = new Set(images.map((image) => image.id));
  return { ...coco, images, annotations: coco.annotations.filter((annotation) => kept.has(annotation.image_id)) };
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A function that calls the training API of one project, waiting out rate limits. */
export function createClient(config, { sleep = pause, log = console.log } = {}) {
  return async function call(method, path, body) {
    for (let attempt = 1; ; attempt += 1) {
      const res = await fetch(`${config.endpoint}/${API}/projects/${config.projectId}/${path}`, {
        method,
        headers: { "Training-Key": config.key, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 429 && attempt <= MAX_RETRIES) {
        const wait = Number(res.headers.get("Retry-After")) || 5;
        log(`  rate limited, waiting ${wait}s`);
        await sleep(wait * 1000);
        continue;
      }
      if (!res.ok) {
        throw new Error(`${method} ${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      }
      return res.json();
    }
  };
}

/** Tag name → id, creating the tags the project does not have yet. */
export async function ensureTags(call, names) {
  const existing = await call("GET", "tags");
  const ids = Object.fromEntries(existing.map((tag) => [tag.name, tag.id]));
  for (const name of names) {
    if (!ids[name]) ids[name] = (await call("POST", `tags?name=${encodeURIComponent(name)}`)).id;
  }
  return ids;
}

/** Uploads the images of each folder in batches. Returns how many ended in each status. */
export async function uploadImages(call, prepared, tagIds, { log = console.log } = {}) {
  const statuses = {};
  for (const { folder, images } of prepared) {
    for (let start = 0; start < images.length; start += BATCH_SIZE) {
      const batch = images.slice(start, start + BATCH_SIZE).map((image) => ({
        name: image.fileName,
        contents: readFileSync(join(folder, image.fileName)).toString("base64"),
        regions: image.regions.map(({ tag, ...box }) => ({ tagId: tagIds[tag], ...box })),
      }));
      const result = await call("POST", "images/files", { images: batch });
      for (const image of result.images ?? []) statuses[image.status] = (statuses[image.status] ?? 0) + 1;
      log(`  ${folder}: ${Math.min(start + BATCH_SIZE, images.length)}/${images.length}`);
    }
  }
  return statuses;
}
