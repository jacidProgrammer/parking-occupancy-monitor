#!/usr/bin/env node
// Uploads a COCO-format dataset (as exported by Roboflow) to an Azure Custom Vision
// object-detection project, with its bounding boxes.
//
//   node scripts/import-dataset.mjs --dir <folder>                                   # classes found, uploads nothing
//   node scripts/import-dataset.mjs --dir <folder> --map car=car,free=free           # what would be uploaded
//   node scripts/import-dataset.mjs --dir <folder> --map car=car,free=free --upload
//
//   --include <regex>   only images whose file name matches
//   --limit <n>         at most n images per folder, to try the upload out
//
// Needs AZURE_CUSTOM_VISION_TRAINING_ENDPOINT, _TRAINING_KEY and _PROJECT_ID in .env.local.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { countByCategory, toLabelledImages } from "./lib/coco.mjs";
import {
  ANNOTATIONS,
  applyEnvFile,
  createClient,
  ensureTags,
  filterImages,
  findSplits,
  parseArgs,
  trainingConfig,
  uploadImages,
} from "./lib/training.mjs";

const sum = (numbers) => numbers.reduce((total, n) => total + n, 0);

const args = parseArgs(process.argv.slice(2));
const splits = findSplits(args.dir);
if (splits.length === 0) {
  console.error(`No ${ANNOTATIONS} found in ${args.dir} or its subfolders.`);
  process.exit(1);
}

const prepared = [];
for (const folder of splits) {
  const coco = filterImages(JSON.parse(readFileSync(join(folder, ANNOTATIONS), "utf8")), args.include);
  const result = toLabelledImages(coco, args.map);
  const perImage = result.images.map((image) => image.regions.length);
  console.log(`\n${folder}`);
  console.log(`  images${args.include ? " matching --include" : ""}: ${coco.images.length}`);
  console.log(`  boxes per class: ${JSON.stringify(countByCategory(coco))}`);
  if (Object.keys(args.map).length > 0) {
    console.log(`  to upload: ${result.images.length} images, ${sum(perImage)} boxes (max ${Math.max(0, ...perImage)} in one image)`);
    console.log(`  left out: ${result.unlabelled} without boxes, ${result.tooManyRegions} over 300 boxes; ${result.droppedBoxes} boxes outside their image`);
  }
  prepared.push({ folder, images: result.images.slice(0, args.limit) });
}
const total = sum(prepared.map((split) => split.images.length));

if (Object.keys(args.map).length === 0) {
  console.log("\nPass --map <category>=<tag>,... to choose which classes to upload and what to call them.");
  process.exit(0);
}
console.log(`\nTotal to upload: ${total} images.`);
if (!args.upload) {
  console.log("Report only. Add --upload to send them to Custom Vision.");
  process.exit(0);
}

if (existsSync(".env.local")) applyEnvFile(readFileSync(".env.local", "utf8"), process.env);
const config = trainingConfig(process.env);
if (!config) {
  console.error("Set AZURE_CUSTOM_VISION_TRAINING_ENDPOINT, AZURE_CUSTOM_VISION_TRAINING_KEY and AZURE_CUSTOM_VISION_PROJECT_ID in .env.local.");
  process.exit(1);
}

const call = createClient(config);
const tagIds = await ensureTags(call, [...new Set(Object.values(args.map))]);
const statuses = await uploadImages(call, prepared, tagIds);
console.log(`\nUpload result by status: ${JSON.stringify(statuses)}`);
