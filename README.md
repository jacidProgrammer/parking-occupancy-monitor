# Parking Lot Occupancy Monitor

Portfolio demo: upload an aerial photo of a parking lot and a detector trained with **Azure Custom Vision** finds the cars and the free bays. The app turns that into occupancy (occupied / free / % full) with a gauge, a status colour and a history kept in the browser.

Stack: Next.js 14 (App Router) · TypeScript · shadcn/ui · Recharts · Azure Custom Vision (object detection).

## Run it

```bash
cp .env.example .env.local   # then fill in the two prediction values
npm install
npm run dev
```

| Variable | Where it comes from |
| --- | --- |
| `AZURE_CUSTOM_VISION_PREDICTION_URL` | customvision.ai → your project → Performance → **Prediction URL** → the URL under "If you have an image file" (ends in `/image`) |
| `AZURE_CUSTOM_VISION_PREDICTION_KEY` | Same dialog → `Prediction-Key` |

Both are read only on the server (`lib/server/custom-vision.ts`); the key never reaches the browser. Restart `npm run dev` after editing `.env.local`.


## Tests

None of them needs an Azure account or spends a prediction.

| Command | What it runs |
| --- | --- |
| `npm test` | Unit and component tests (Vitest, jsdom for what is drawn). Azure is a stubbed `fetch`. |
| `npm run test:coverage` | The same, failing below 100 % of lines, statements and functions or 98 % of branches. |
| `npm run test:e2e` | The real page in Chromium (Playwright), with the analysis API answered by the test, plus a few checks against the running server, which is started without Azure settings. |
| `npm run lint` · `npm run typecheck` | ESLint and TypeScript. |

`tests/import-dataset.test.ts` runs the dataset command for real against a local stand-in for the training API.

What no test covers: Azure itself. The shape of a Custom Vision answer is the one observed on 2026-10-06 (`tests/route.test.ts`); if Azure changed it, only a real upload would show it.

`.github/workflows/ci.yml` runs all of the above on every push to `main` and every pull request, and runs the browser tests against the packaged server (`npm run package`), the same one that is deployed.

## How it works

```
browser                                              server                     Azure
  photo ─ cut into 3×3 overlapping tiles
        ─ each tile, one at a time ──▶ POST /api/analyze-parking ──▶ Custom Vision prediction
        ◀─ cars + free bays (boxes as fractions of the tile) ◀──────┘
  merge tiles ─▶ canvas overlay, occupancy, history (localStorage)
```

- **Why tiles.** The model learned from images where a car is 10–25 % of the side. In a drone photo of a whole lot a car is 3–4 %, and the model finds few of them: on a 1981×2000 photo with roughly 70 cars it found 17 analyzing it whole, and 59 through tiles.
- **Overlap and merge** (`lib/tiling.ts`). Tiles share 25 % of their size, more than a car length. A box touching an inner tile edge is dropped, because the neighbouring tile has that object whole. An object seen by two tiles, returned twice by the model (a second box shifted by half a bay), or read as both car and free bay, is kept once with its most confident reading: two boxes are the same object when one covers 40 % of the other.
- **Confidence threshold 0.3** (`lib/server/detections.ts`).
- **Occupied** = cars. **Total** = cars + free bays seen in the photo, unless you type the lot's capacity, which then wins. When the typed capacity and the photo differ by more than 10 %, the screen says so.
- **Status**: green below 50 %, yellow from 50 % to 80 %, red above 80 %.
- A photo where the model sees neither cars nor free bays is reported as not understood, never as "0 % full": a truly empty lot still shows its bays.
- Each history entry keeps the total it was computed against and where that total came from. The full photo is never stored, only a 160 px thumbnail.
- Any format the browser can decode works (WEBP included): tiles are re-encoded as JPEG before upload.

One photo costs **9 predictions**. The free tier allows 2 per second, so tiles go one at a time and a photo takes about 10 seconds.

### Layout

| Where | What |
| --- | --- |
| `app/api/analyze-parking/route.ts` | The only endpoint |
| `lib/server/` | Runs only on the server: Custom Vision client, rate limits |
| `lib/client/` | Runs only in the browser: tiling a photo, thumbnails, history in `localStorage` |
| `lib/*.ts` | Pure logic both sides use: merging tiles, occupancy, upload limits, types |
| `hooks/use-parking-monitor.ts` | The page's state |
| `components/` | What is drawn |

`tests/structure.test.ts` fails if browser code imports `lib/server/`, if server code imports `lib/client/`, or if anything outside `lib/server/` reads an environment variable.

### API

`POST /api/analyze-parking`, `multipart/form-data` with one image (a tile) in `image`.

```jsonc
{
  "detections": [
    { "kind": "car",  "confidence": 0.97, "box": { "x": 0.1, "y": 0.2, "w": 0.25, "h": 0.5 } },
    { "kind": "free", "confidence": 0.81, "box": { "x": 0.5, "y": 0.2, "w": 0.25, "h": 0.5 } }
  ]
}
```

Boxes are fractions (0–1) of the image sent, origin at its top-left. Errors are `{ "error": { "code", "message", "retryAfterSeconds?" } }`:

| HTTP | code | Meaning |
| --- | --- | --- |
| 400 | `missing_file`, `empty_file`, `invalid_request` | Bad upload |
| 413 | `file_too_large` | Over 4 MB |
| 415 | `unsupported_type` | Not JPEG/PNG/GIF/BMP |
| 422 | `invalid_image` | Azure rejected the image (message included) |
| 429 | `too_many_requests`, `daily_limit_reached` | This app's own limits (see below) |
| 429 | `rate_limited` | Azure quota hit; `Retry-After` is forwarded |
| 502 / 504 | `azure_auth`, `azure_endpoint`, `azure_error`, `azure_unreachable`, `azure_timeout` | Azure-side or configuration problem |
| 503 | `not_configured` | Env vars missing |

## Protection against mass requests

The API is public and every call spends a prediction, so `lib/server/request-guard.ts` counts requests before anything else happens:

| Limit | Value | Answer when exceeded |
| --- | --- | --- |
| Per visitor (IP address) | 90 requests an hour = 10 photos | `429 too_many_requests` |
| Whole app | 300 requests a day, which keeps a month under the 10,000 free predictions | `429 daily_limit_reached` |
| Upload size | 4 MB, refused from `Content-Length` before the body is read | `413 file_too_large` |

Both 429s carry `Retry-After`, and the screen shows the message with the wait. A visitor over their own limit does not consume the shared daily allowance.

The visitor's address is the last entry of `X-Forwarded-For`, the one Azure App Service appends; earlier entries are whatever the caller sent and are ignored.

What this does not do: the counters live in the memory of one server process, so they reset when the app restarts and would not be shared between several instances (the free App Service tier runs one). An attacker with many IP addresses is stopped only by the daily limit, and can use it up for everyone else that day. It limits spending, it is not DDoS protection.

## The model

### Why a custom model

Azure's general Image Analysis model does not recognize cars seen from straight above. Measured on 2026-10-06 with the drone photo mentioned above: Analyze Image v3.2 and Image Analysis 4.0 both returned 0 objects and the single tag `screenshot`; on enlarged 2×2 and 3×3 tiles they found 2 and 1 cars and labelled others `cell phone`, `telephone` and `Camera`.

### Training data

[parking lot](https://universe.roboflow.com/abdullah-hvgvv/parking-lot-j4ojc) by a Roboflow user, CC BY 4.0, exported as COCO. It has two classes, `car` and `free`, on 640×640 images, each source image present three times with small rotations and brightness changes.

The dataset mixes aerial views with underground garages and street-level photos. Only the aerial part was used, selected by file name (`^(4k-time-lapse|istock|\d+_png)`):

| Split | Images | `car` boxes | `free` boxes | Use |
| --- | --- | --- | --- | --- |
| train | 777 | 33,772 | 15,050 | uploaded |
| valid | 40 | 1,565 | 516 | uploaded |
| test | 86 | 2,368 | 2,436 | held out |

Part of the aerial images are frames of stock-footage videos, some with a visible watermark, so the dataset is not redistributed here.

### Reproduce it

1. Azure portal → create a **Custom Vision** resource (training and prediction), tier F0.
2. customvision.ai → new project → **Object Detection**, domain **General**.
3. Download the dataset from Roboflow in **COCO** format.
4. Put the training endpoint, training key and project id in `.env.local` (names in `.env.example`) and upload the images with their boxes:

   ```bash
   node scripts/import-dataset.mjs --dir <dataset>/train --include '^(4k-time-lapse|istock|\d+_png)' --map car=car,free=free            # report only
   node scripts/import-dataset.mjs --dir <dataset>/train --include '^(4k-time-lapse|istock|\d+_png)' --map car=car,free=free --upload
   ```

   The Custom Vision portal cannot import COCO; the script converts each pixel box to the 0–1 fractions the training API expects (`scripts/lib/coco.mjs`).
5. customvision.ai → **Train** → Quick Training (7 minutes of compute for these 817 images), then **Publish** the iteration.

### How good it is

| Measured on | Threshold | Cars found | Free bays found |
| --- | --- | --- | --- |
| Custom Vision's own validation | 0.5 | precision 99 %, recall 90 % | precision 98 %, recall 81 % |
| 43 of the 86 held-out images, by count | 0.3 | 86 % (1,023 of 1,183) | 82 % (1,005 of 1,225) |
| same | 0.5 | 74 % | 67 % |

The portal's figures are optimistic: its validation images are near-copies of training ones. The held-out images come from a different video, were analyzed whole (not tiled), and compare counts only, so a miss and a false alarm cancel out.

## Limitations

- **The model undercounts**, free bays more than cars. With the total taken from the photo, missed free bays push the percentage up.
- **Only aerial views of lots with painted bays.** Street-level photos, garages and unmarked lots mostly come back empty.
- **The 3×3 grid is fixed.** It suits a photo of a whole lot. A close-up with a dozen cars is cut into tiles where each car is too large, and a very high shot leaves them too small.
- **Bays, not the lot.** A photo of half the lot gives half the total, and a car in the driving lane counts as occupied.
- The tile overlap assumes no car is longer than a quarter of a tile.
- History lives in `localStorage`: one browser, one device, 50 entries.
- **Custom Vision is being retired**: Microsoft supports it until 2028-09-25 and points to Azure Machine Learning AutoML for custom object detection.

## Free tier

Custom Vision F0: 2 projects, 5,000 training images per project, 1 hour of training per month, 10,000 predictions per month at 2 per second. At 9 predictions per photo that is about 1,100 photos a month. See [limits and quotas](https://learn.microsoft.com/azure/ai-services/custom-vision-service/limits-and-quotas).
