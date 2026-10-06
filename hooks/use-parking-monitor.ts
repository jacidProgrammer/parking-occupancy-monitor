import { useEffect, useRef, useState } from "react";
import { analyzePhoto } from "@/lib/client/analyze-photo";
import {
  addEntry,
  loadHistory,
  loadTotalSpaces,
  saveHistory,
  saveTotalSpaces,
  type HistoryEntry,
} from "@/lib/client/history";
import { makeThumbnail } from "@/lib/client/thumbnail";
import { photoProblem } from "@/lib/limits";
import { parseTotalSpaces, resolveTotal } from "@/lib/occupancy";
import type { ParkingAnalysis } from "@/lib/types";

export interface CurrentPhoto {
  url: string;
  fileName: string;
  /** null while the photo is still being analyzed. */
  analysis: ParkingAnalysis | null;
  entryId: string | null;
}

/** Everything the page remembers: the typed capacity, the photo on screen and the history. */
export function useParkingMonitor() {
  const [hydrated, setHydrated] = useState(false);
  const [totalInput, setTotalInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [current, setCurrent] = useState<CurrentPhoto | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notSaved, setNotSaved] = useState(false);
  const currentUrl = useRef<string | null>(null);

  const analyzing = progress !== null;
  const totalEmpty = totalInput.trim() === "";
  const manualTotal = parseTotalSpaces(totalInput);
  const totalInvalid = hydrated && !totalEmpty && !manualTotal;

  useEffect(() => {
    setHistory(loadHistory(window.localStorage));
    const saved = loadTotalSpaces(window.localStorage);
    if (saved) setTotalInput(String(saved));
    setHydrated(true);
    return () => {
      if (currentUrl.current) URL.revokeObjectURL(currentUrl.current);
    };
  }, []);

  useEffect(() => {
    if (hydrated) setNotSaved(!saveHistory(window.localStorage, history));
  }, [hydrated, history]);

  useEffect(() => {
    if (hydrated && (manualTotal || totalEmpty)) saveTotalSpaces(window.localStorage, manualTotal);
  }, [hydrated, manualTotal, totalEmpty]);

  const show = (next: CurrentPhoto | null) => {
    if (currentUrl.current && currentUrl.current !== next?.url) {
      URL.revokeObjectURL(currentUrl.current);
    }
    currentUrl.current = next?.url ?? null;
    setCurrent(next);
  };

  const analyze = async (file: File) => {
    if (analyzing || totalInvalid) return;
    const problem = photoProblem(file);
    if (problem) {
      setError(problem);
      return;
    }
    const url = URL.createObjectURL(file);
    setError(null);
    setProgress({ done: 0, total: 0 });
    show({ url, fileName: file.name, analysis: null, entryId: null });
    try {
      const analysis = await analyzePhoto(url, (done, total) => setProgress({ done, total }));
      const resolved = resolveTotal(analysis.cars, analysis.free, manualTotal);
      if (!resolved) {
        throw new Error(
          "The model found no cars and no free bays in this photo. It was trained on aerial views of marked parking lots, so other kinds of photo usually come back empty.",
        );
      }
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        fileName: file.name,
        vehicles: analysis.cars,
        totalSpaces: resolved.total,
        totalSource: resolved.source,
        detectedSpaces: resolved.detected,
        thumbnail: await makeThumbnail(url),
      };
      setHistory((previous) => addEntry(previous, entry));
      show({ url, fileName: file.name, analysis, entryId: entry.id });
    } catch (cause) {
      show(null);
      setError(cause instanceof Error ? cause.message : "Analysis failed.");
    } finally {
      setProgress(null);
    }
  };

  const deleteEntry = (id: string) => {
    setHistory((previous) => previous.filter((entry) => entry.id !== id));
    if (current?.entryId === id) show(null);
  };

  const clearHistory = () => {
    if (!window.confirm(`Delete all ${history.length} uploads from the history?`)) return;
    setHistory([]);
    if (current?.entryId) show(null);
  };

  return {
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
  };
}
