"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { HistoryList } from "@/components/history-list";
import { OccupancyCard } from "@/components/occupancy-card";
import { KIND_STYLE, ParkingCanvas } from "@/components/parking-canvas";
import { TrendChart } from "@/components/trend-chart";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { UploadDropzone } from "@/components/upload-dropzone";
import { useParkingMonitor } from "@/hooks/use-parking-monitor";
import { MAX_HISTORY } from "@/lib/client/history";
import { MAX_TOTAL_SPACES } from "@/lib/occupancy";
import type { DetectionKind } from "@/lib/types";

export default function Home() {
  const {
    hydrated,
    totalInput,
    setTotalInput,
    totalInvalid,
    history,
    current,
    progress,
    analyzing,
    error,
    notSaved,
    analyze,
    deleteEntry,
    clearHistory,
  } = useParkingMonitor();

  return (
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Parking Lot Occupancy Monitor</h1>
        <p className="text-muted-foreground">
          Upload an aerial photo of a parking lot and a model trained with Azure Custom Vision
          finds the cars and the free bays.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Lot capacity (optional)</CardTitle>
              <CardDescription>
                Leave it empty and the total is counted from each photo: cars plus free bays. If
                you know the real number, type it and it is used instead for new uploads.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-3">
                <Input
                  id="total-spaces"
                  inputMode="numeric"
                  placeholder="from photo"
                  aria-label="Total parking spaces"
                  aria-invalid={totalInvalid}
                  className="w-32"
                  value={totalInput}
                  disabled={!hydrated}
                  onChange={(event) => setTotalInput(event.target.value)}
                />
                <label htmlFor="total-spaces" className="text-sm text-muted-foreground">
                  total spaces
                </label>
              </div>
              {totalInvalid && (
                <p className="text-sm text-destructive" role="alert">
                  Enter a whole number between 1 and {MAX_TOTAL_SPACES.toLocaleString()}, or leave
                  it empty.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Photo</CardTitle>
              <CardDescription>
                Shot from above, with the bays marked on the ground. One photo per upload.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <UploadDropzone
                onFile={analyze}
                disabled={analyzing || totalInvalid}
                disabledHint={analyzing ? "Analyzing…" : "Fix the lot capacity first."}
              />

              {error && (
                <Alert variant="destructive">
                  <AlertCircle aria-hidden />
                  <span>{error}</span>
                </Alert>
              )}

              {current && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="truncate text-sm font-medium">{current.fileName}</p>
                    {current.analysis ? (
                      <ul className="flex gap-4 text-sm" aria-label="Detected in the photo">
                        {(["car", "free"] as DetectionKind[]).map((kind) => (
                          <li key={kind} className="flex items-center gap-1.5" data-testid={`count-${kind}`}>
                            <span
                              className="h-3 w-3 rounded-sm border-2"
                              style={{
                                borderColor: KIND_STYLE[kind].stroke,
                                backgroundColor: KIND_STYLE[kind].fill,
                              }}
                              aria-hidden
                            />
                            {kind === "car" ? current.analysis!.cars : current.analysis!.free}{" "}
                            {KIND_STYLE[kind].label}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        {progress && progress.total > 0
                          ? `Analyzing section ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                          : "Preparing the photo…"}
                      </span>
                    )}
                  </div>
                  <ParkingCanvas src={current.url} analysis={current.analysis} />
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <OccupancyCard latest={history[0]} className="self-start" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Occupancy trend</CardTitle>
            <CardDescription>
              Occupancy of each upload, oldest to newest. Dashed lines mark 50% and 80%.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TrendChart history={history} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between space-y-0">
            <div className="space-y-1.5">
              <CardTitle>History</CardTitle>
              <CardDescription>
                Last {MAX_HISTORY} uploads, newest first. Stored only in this browser.
              </CardDescription>
            </div>
            {history.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearHistory}>
                Clear all
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {notSaved && (
              <Alert variant="destructive">
                <AlertCircle aria-hidden />
                <span>
                  The browser refused to save the history (storage full or blocked). It will be
                  lost when you close this tab.
                </span>
              </Alert>
            )}
            <HistoryList history={history} onDelete={deleteEntry} />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
