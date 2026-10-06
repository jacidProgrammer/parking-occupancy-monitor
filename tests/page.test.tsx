// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { cloneElement, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import { analyzePhoto } from "@/lib/client/analyze-photo";
import { HISTORY_KEY, TOTAL_SPACES_KEY } from "@/lib/client/history";
import type { ParkingAnalysis } from "@/lib/types";
import { fakeCanvas, fakeImage, fakeObjectUrls } from "./browser-fakes";

// A chart sizes itself from its container, which has no size in jsdom: give it one.
vi.mock("recharts", async (original) => ({
  ...(await original<typeof import("recharts")>()),
  ResponsiveContainer: ({ children }: { children: ReactElement }) => cloneElement(children, { width: 400, height: 200 }),
}));
vi.mock("@/lib/client/analyze-photo", () => ({ analyzePhoto: vi.fn() }));
vi.mock("@/lib/client/thumbnail", () => ({ makeThumbnail: vi.fn().mockResolvedValue(undefined) }));

const seen = (cars: number, free: number): ParkingAnalysis => ({ width: 100, height: 100, detections: [], cars, free });
const photo = (name = "lot.webp", type = "image/webp") => new File(["x"], name, { type });
const capacity = () => screen.getByLabelText<HTMLInputElement>("Total parking spaces");
const picker = () => screen.getByLabelText<HTMLInputElement>("Upload parking lot photo");

async function open() {
  render(<Home />);
  await waitFor(() => expect(capacity()).toBeEnabled());
}

beforeEach(() => {
  window.localStorage.clear();
  fakeObjectUrls();
  fakeImage();
  fakeCanvas();
  vi.mocked(analyzePhoto).mockReset().mockResolvedValue(seen(59, 118));
});

describe("the page", () => {
  it("starts empty: no photo, no occupancy, no history", async () => {
    await open();
    expect(screen.getByText("Shown after your first upload.")).toBeInTheDocument();
    expect(screen.getByText("The trend appears after your first upload.")).toBeInTheDocument();
    expect(screen.getByText(/^No uploads yet\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
    expect(screen.queryByRole("img", { name: /Uploaded photo/ })).toBeNull();
    expect(capacity().value).toBe("");
  });

  it("after an upload shows what was found, the occupancy and the upload in the history", async () => {
    await open();
    await userEvent.upload(picker(), photo());
    expect(await screen.findByTestId("count-car")).toHaveTextContent("59 cars");
    expect(screen.getByTestId("count-free")).toHaveTextContent("118 free bays");
    expect(screen.getByRole("img", { name: "Uploaded photo with 59 cars and 118 free bays outlined" })).toBeInTheDocument();
    expect(screen.getByTestId("stat-total")).toHaveTextContent("177");
    expect(screen.getByTestId("stat-occupied")).toHaveTextContent("59");
    expect(screen.getByTestId("stat-free")).toHaveTextContent("118");
    expect(screen.getByTestId("gauge-percent")).toHaveTextContent("33.3%");
    expect(screen.getByTestId("total-source")).toHaveTextContent("Total counted in the photo: 59 cars + 118 free bays = 177 spaces.");
    const items = screen.getAllByTestId("history-item");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("59 of 177 spaces");
    expect(screen.getByTestId("trend-chart")).toBeInTheDocument();
  });

  it("uses the capacity typed before the upload, and remembers it", async () => {
    await open();
    await userEvent.type(capacity(), "168");
    await userEvent.upload(picker(), photo());
    expect(await screen.findByTestId("stat-total")).toHaveTextContent("168");
    expect(screen.getByTestId("stat-free")).toHaveTextContent("109");
    expect(screen.getByTestId("gauge-percent")).toHaveTextContent("35.1%");
    expect(window.localStorage.getItem(TOTAL_SPACES_KEY)).toBe("168");
  });

  it("says which section is being analyzed and locks the upload meanwhile", async () => {
    let report: (done: number, total: number) => void = () => {};
    let finish: (analysis: ParkingAnalysis) => void = () => {};
    vi.mocked(analyzePhoto).mockImplementation((_, onProgress) => {
      report = onProgress;
      return new Promise((resolve) => (finish = resolve));
    });
    await open();
    await userEvent.upload(picker(), photo());
    expect(await screen.findByRole("status")).toHaveTextContent("Preparing the photo…");
    expect(screen.getByText("Analyzing…")).toBeInTheDocument();
    expect(picker()).toBeDisabled();
    expect(screen.getByRole("img", { name: "Uploaded photo" })).toBeInTheDocument();

    report(0, 9);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Analyzing section 1 of 9…"));
    report(9, 9);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Analyzing section 9 of 9…"));

    finish(seen(2, 2));
    expect(await screen.findByTestId("count-car")).toHaveTextContent("2 cars");
    expect(screen.queryByRole("status")).toBeNull();
    expect(picker()).toBeEnabled();
  });

  it("shows an error and adds nothing when the photo is not understood", async () => {
    vi.mocked(analyzePhoto).mockResolvedValue(seen(0, 0));
    await open();
    await userEvent.type(capacity(), "100");
    await userEvent.upload(picker(), photo());
    expect(await screen.findByRole("alert")).toHaveTextContent("The model found no cars and no free bays in this photo.");
    expect(screen.queryByTestId("history-item")).toBeNull();
    expect(screen.queryByTestId("stat-total")).toBeNull();
    expect(screen.queryByRole("img", { name: /Uploaded photo/ })).toBeNull();
  });

  it("explains an invalid capacity and blocks the upload until it is fixed", async () => {
    await open();
    await userEvent.type(capacity(), "0");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a whole number between 1 and 10,000, or leave it empty.");
    expect(capacity()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Fix the lot capacity first.")).toBeInTheDocument();
    expect(picker()).toBeDisabled();
    await userEvent.clear(capacity());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(picker()).toBeEnabled();
  });

  it("restores the history after a reload and clears it on request", async () => {
    await open();
    await userEvent.upload(picker(), photo("first.webp"));
    await screen.findByTestId("history-item");
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem(HISTORY_KEY)!)).toHaveLength(1));
    document.body.innerHTML = "";

    await open();
    expect(screen.getByTestId("history-item")).toHaveTextContent("first.webp");
    expect(screen.getByTestId("stat-total")).toHaveTextContent("177");
    // The photo itself is not kept: only its numbers come back.
    expect(screen.queryByRole("img", { name: /Uploaded photo/ })).toBeNull();

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await userEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(screen.queryByTestId("history-item")).toBeNull();
    expect(screen.getByText("Shown after your first upload.")).toBeInTheDocument();
  });

  it("deletes one upload from the history", async () => {
    await open();
    await userEvent.upload(picker(), photo("first.webp"));
    await screen.findByTestId("history-item");
    vi.mocked(analyzePhoto).mockResolvedValue(seen(10, 10));
    await userEvent.upload(picker(), photo("second.webp"));
    await waitFor(() => expect(screen.getAllByTestId("history-item")).toHaveLength(2));
    expect(screen.getByTestId("stat-total")).toHaveTextContent("20");

    await userEvent.click(screen.getByRole("button", { name: "Delete second.webp from history" }));
    expect(screen.getAllByTestId("history-item")).toHaveLength(1);
    // The occupancy card falls back to the upload that is left.
    expect(screen.getByTestId("stat-total")).toHaveTextContent("177");
    expect(screen.queryByRole("img", { name: /Uploaded photo/ })).toBeNull();
  });

  it("warns when the browser cannot save the history", async () => {
    await open();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    await userEvent.upload(picker(), photo());
    expect(await screen.findByText(/The browser refused to save the history/)).toBeInTheDocument();
  });
});
