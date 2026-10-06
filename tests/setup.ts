import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Recent Node versions define their own `localStorage` global (undefined unless a flag
// gives it a file), which hides the one of the simulated browser. Put jsdom's back.
const browser = (globalThis as { jsdom?: { window: Window & typeof globalThis } }).jsdom?.window;
if (browser) {
  for (const name of ["localStorage", "sessionStorage", "Storage"] as const) {
    Object.defineProperty(globalThis, name, { value: browser[name], configurable: true, writable: true });
  }
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
