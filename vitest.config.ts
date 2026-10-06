import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  esbuild: { jsx: "automatic" },
  test: {
    // Logic runs in node; tests that draw start with `// @vitest-environment jsdom`.
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["app/**", "components/**", "hooks/**", "lib/**", "scripts/**"],
      exclude: [
        // Only loads fonts and wraps the page: the browser tests cover it.
        "app/layout.tsx",
        // Types only: nothing runs.
        "lib/types.ts",
        // A command: tests/import-dataset.test.ts runs it as a separate process, which this report cannot see into.
        "scripts/import-dataset.mjs",
        "scripts/package-for-azure.sh",
      ],
      reporter: ["text", "text-summary"],
      thresholds: { lines: 100, statements: 100, functions: 100, branches: 98 },
    },
  },
});
