// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cloneElement, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { HistoryList } from "@/components/history-list";
import { OccupancyCard } from "@/components/occupancy-card";
import { OccupancyGauge } from "@/components/occupancy-gauge";
import { ParkingCanvas } from "@/components/parking-canvas";
import { TrendChart } from "@/components/trend-chart";
import { UploadDropzone } from "@/components/upload-dropzone";
import type { HistoryEntry } from "@/lib/client/history";
import { computeOccupancy } from "@/lib/occupancy";
import type { ParkingAnalysis } from "@/lib/types";
import { fakeCanvas, fakeImage } from "./browser-fakes";

// A chart sizes itself from its container, which has no size in jsdom: give it one.
vi.mock("recharts", async (original) => ({
  ...(await original<typeof import("recharts")>()),
  ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 400, height: 200 }),
}));

const entry = (id: string, overrides: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id,
  timestamp: "2026-10-05T10:00:00.000Z",
  fileName: `${id}.jpg`,
  vehicles: 59,
  totalSpaces: 168,
  totalSource: "manual",
  detectedSpaces: 177,
  ...overrides,
});
const stat = (name: string) => screen.getByTestId(`stat-${name}`).textContent;

describe("OccupancyCard", () => {
  it("promises nothing before the first upload", () => {
    render(<OccupancyCard latest={undefined} />);
    expect(screen.getByText("Shown after your first upload.")).toBeInTheDocument();
    expect(screen.queryByTestId("status")).toBeNull();
    expect(screen.queryByTestId("gauge-percent")).toBeNull();
  });

  it("shows the three counts, the percentage, the status and where the total comes from", () => {
    render(<OccupancyCard latest={entry("lot")} />);
    expect(screen.getByText(/^Latest upload: lot\.jpg · /)).toBeInTheDocument();
    expect([stat("total"), stat("occupied"), stat("free")]).toEqual(["168", "59", "109"]);
    expect(screen.getByTestId("gauge-percent")).toHaveTextContent("35.1%");
    expect(screen.getByTestId("status")).toHaveTextContent("Plenty of space");
    expect(screen.getByTestId("status")).toHaveAttribute("data-status", "green");
    expect(screen.getByTestId("total-source")).toHaveTextContent(
      "Total entered by you: 168. The photo shows 59 cars + 118 free bays = 177 spaces.",
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    [84, 168, "yellow", "Filling up"],
    [135, 168, "red", "Almost full"],
  ])("%i of %i is %s", (vehicles, totalSpaces, status, label) => {
    render(<OccupancyCard latest={entry("lot", { vehicles, totalSpaces, detectedSpaces: totalSpaces, totalSource: "detected" })} />);
    expect(screen.getByTestId("status")).toHaveAttribute("data-status", status);
    expect(screen.getByTestId("status")).toHaveTextContent(label);
  });

  it("warns when the typed capacity and the photo disagree", () => {
    render(<OccupancyCard latest={entry("lot", { vehicles: 63, detectedSpaces: 189 })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("differ by more than 10%");
  });

  it("explains the cap, and only that, when there are more cars than the typed capacity", () => {
    render(<OccupancyCard latest={entry("lot", { vehicles: 120, totalSpaces: 100, detectedSpaces: 130 })} />);
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("120 cars were detected but you entered 100 spaces, so occupancy is capped at 100%.");
    expect([stat("occupied"), stat("free")]).toEqual(["100", "0"]);
    expect(screen.getByTestId("gauge-percent")).toHaveTextContent("100%");
  });
});

describe("OccupancyGauge", () => {
  it("draws the arc in the status colour and reads out the figure", () => {
    const { container } = render(<OccupancyGauge occupancy={computeOccupancy(135, 168)} />);
    expect(screen.getByRole("img", { name: "Occupancy 80.4%: Almost full" })).toBeInTheDocument();
    expect(screen.getByTestId("gauge-percent")).toHaveTextContent("80.4%");
    expect(container.querySelector('path[fill="#dc2626"]')).not.toBeNull();
  });
});

describe("TrendChart", () => {
  it("says when there is nothing to plot", () => {
    render(<TrendChart history={[]} />);
    expect(screen.getByText("The trend appears after your first upload.")).toBeInTheDocument();
    expect(screen.queryByTestId("trend-chart")).toBeNull();
  });

  it("plots one dot per upload, oldest first, in its status colour, with both thresholds", () => {
    const history = [
      entry("newest", { vehicles: 160 }), // 95.2 % red
      entry("middle", { vehicles: 100 }), // 59.5 % yellow
      entry("oldest", { vehicles: 20 }), // 11.9 % green
    ];
    const { container } = render(<TrendChart history={history} />);
    const dots = Array.from(container.querySelectorAll("circle"));
    expect(dots.map((dot) => dot.getAttribute("fill"))).toEqual(["#16a34a", "#ca8a04", "#dc2626"]);
    const heights = dots.map((dot) => Number(dot.getAttribute("cy")));
    expect(heights[0]).toBeGreaterThan(heights[1]);
    expect(heights[1]).toBeGreaterThan(heights[2]);
    expect(container.querySelectorAll(".recharts-reference-line-line")).toHaveLength(2);
    expect(Array.from(container.querySelectorAll(".recharts-xAxis .recharts-cartesian-axis-tick-value")).map((tick) => tick.textContent)).toEqual(["#1", "#2", "#3"]);
  });
});

describe("TrendChart tooltip", () => {
  it("tells the upload's numbers when the pointer is over the chart", () => {
    const { container } = render(<TrendChart history={[entry("only", { timestamp: "2026-10-05T10:00:00.000Z" })]} />);
    const chart = container.querySelector(".recharts-wrapper")!;
    expect(chart).not.toHaveTextContent("59 of 168 spaces");
    fireEvent.mouseMove(chart, { clientX: 200, clientY: 100 });
    expect(chart).toHaveTextContent("#1 · 35.1%");
    expect(chart).toHaveTextContent("59 of 168 spaces");
    expect(chart).toHaveTextContent(new Date("2026-10-05T10:00:00.000Z").toLocaleString());
  });
});

describe("HistoryList", () => {
  it("says when it is empty", () => {
    render(<HistoryList history={[]} onDelete={vi.fn()} />);
    expect(screen.getByText(/^No uploads yet\./)).toBeInTheDocument();
    expect(screen.queryByTestId("history-item")).toBeNull();
  });

  it("lists each upload with its counts, percentage and status, and deletes the right one", async () => {
    const onDelete = vi.fn();
    const { container } = render(
      <HistoryList
        history={[entry("b", { thumbnail: "data:image/jpeg;base64,xx" }), entry("a", { vehicles: 160 })]}
        onDelete={onDelete}
      />,
    );
    const [first, second] = screen.getAllByTestId("history-item");
    expect(first).toHaveTextContent("b.jpg");
    expect(first).toHaveTextContent("59 of 168 spaces");
    expect(first).toHaveTextContent("35.1%");
    expect(within(first).getByRole("img", { name: "Plenty of space" })).toBeInTheDocument();
    expect(second).toHaveTextContent("160 of 168 spaces");
    expect(within(second).getByRole("img", { name: "Almost full" })).toBeInTheDocument();
    // Only the upload that kept a thumbnail shows a picture.
    expect(Array.from(container.querySelectorAll("img")).map((img) => img.getAttribute("src"))).toEqual(["data:image/jpeg;base64,xx"]);

    await userEvent.click(screen.getByRole("button", { name: "Delete a.jpg from history" }));
    expect(onDelete.mock.calls).toEqual([["a"]]);
  });
});

describe("UploadDropzone", () => {
  const file = new File(["x"], "lot.jpg", { type: "image/jpeg" });
  const setup = (disabled = false) => {
    const onFile = vi.fn();
    const view = render(<UploadDropzone onFile={onFile} disabled={disabled} disabledHint="Analyzing…" />);
    const input = screen.getByLabelText<HTMLInputElement>("Upload parking lot photo");
    return { onFile, input, zone: view.container.firstElementChild as HTMLElement };
  };

  it("names the formats and the size limit, and accepts exactly those formats", () => {
    const { input } = setup();
    expect(screen.getByText("JPEG, PNG, GIF, BMP or WEBP · up to 25 MB")).toBeInTheDocument();
    expect(input.accept).toBe("image/jpeg,image/png,image/gif,image/bmp,image/webp");
  });

  it("hands over a chosen file, and the same file can be chosen again", async () => {
    const { onFile, input } = setup();
    await userEvent.upload(input, file);
    expect(onFile.mock.calls).toEqual([[file]]);
    expect(input.value).toBe("");
  });

  it("opens the file picker from the button", async () => {
    const { input } = setup();
    const click = vi.spyOn(input, "click");
    await userEvent.click(screen.getByRole("button", { name: "Browse files" }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("hands over a dropped file and highlights while dragging over", () => {
    const { onFile, zone } = setup();
    fireEvent.dragOver(zone);
    expect(zone.className).toContain("border-primary");
    fireEvent.dragLeave(zone);
    expect(zone.className).not.toContain("border-primary");
    fireEvent.dragOver(zone);
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(onFile.mock.calls).toEqual([[file]]);
    expect(zone.className).not.toContain("border-primary");
  });

  it("ignores a drop with no file", () => {
    const { onFile, zone } = setup();
    fireEvent.drop(zone, { dataTransfer: { files: [] } });
    expect(onFile).not.toHaveBeenCalled();
  });

  it("when disabled says why, does not highlight and ignores drops", () => {
    const { onFile, input, zone } = setup(true);
    expect(screen.getByText("Analyzing…")).toBeInTheDocument();
    expect(screen.queryByText(/up to 25 MB/)).toBeNull();
    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "Browse files" })).toBeDisabled();
    fireEvent.dragOver(zone);
    expect(zone.className).not.toContain("border-primary");
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });
    expect(onFile).not.toHaveBeenCalled();
  });
});

describe("ParkingCanvas", () => {
  const analysis: ParkingAnalysis = {
    width: 1000,
    height: 500,
    cars: 1,
    free: 1,
    detections: [
      { kind: "car", confidence: 0.9, box: { x: 100, y: 50, w: 200, h: 100 } },
      { kind: "free", confidence: 0.8, box: { x: 600, y: 50, w: 200, h: 100 } },
    ],
  };

  it("draws the photo at its own size with one box per detection, cars blue and free bays green", async () => {
    fakeImage({ width: 1000, height: 500 });
    const { drawImage, boxes, drawing } = fakeCanvas();
    render(<ParkingCanvas src="blob:photo" analysis={analysis} />);
    const canvas = screen.getByRole<HTMLCanvasElement>("img", {
      name: "Uploaded photo with 1 cars and 1 free bays outlined",
    });
    await waitFor(() => expect(boxes).toHaveLength(2));
    expect([canvas.width, canvas.height]).toEqual([1000, 500]);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(boxes).toEqual([
      { stroke: "#2563eb", fill: "rgba(37, 99, 235, 0.18)", rect: [100, 50, 200, 100] },
      { stroke: "#16a34a", fill: "rgba(22, 163, 74, 0.18)", rect: [600, 50, 200, 100] },
    ]);
    expect(drawing.fillRect.mock.calls).toEqual([[100, 50, 200, 100], [600, 50, 200, 100]]);
    expect(drawing.lineWidth).toBe(2.5);
  });

  it("scales the boxes when the photo on screen is not the size that was analyzed", async () => {
    fakeImage({ width: 2000, height: 1000 });
    const { boxes } = fakeCanvas();
    render(<ParkingCanvas src="blob:photo" analysis={analysis} />);
    await waitFor(() => expect(boxes).toHaveLength(2));
    expect(boxes[0].rect).toEqual([200, 100, 400, 200]);
  });

  it("draws only the photo while there is no analysis, or when its size is unknown", async () => {
    fakeImage({ width: 1000, height: 500 });
    const { drawImage, boxes } = fakeCanvas();
    const { rerender } = render(<ParkingCanvas src="blob:photo" analysis={null} />);
    expect(screen.getByRole("img", { name: "Uploaded photo" })).toBeInTheDocument();
    await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(1));
    rerender(<ParkingCanvas src="blob:photo" analysis={{ ...analysis, width: 0 }} />);
    await waitFor(() => expect(drawImage).toHaveBeenCalledTimes(2));
    expect(boxes).toEqual([]);
  });

  it("does not draw a photo that was replaced before it loaded", async () => {
    fakeImage({ width: 1000, height: 500 });
    const { drawImage } = fakeCanvas();
    const { unmount } = render(<ParkingCanvas src="blob:photo" analysis={analysis} />);
    unmount();
    await Promise.resolve();
    expect(drawImage).not.toHaveBeenCalled();
  });
});
