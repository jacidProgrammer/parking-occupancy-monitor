import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  const absolute = join(root, dir);
  return readdirSync(absolute).flatMap((name) => {
    const path = join(absolute, name);
    if (statSync(path).isDirectory()) return sourceFiles(relative(root, path));
    return /\.tsx?$/.test(name) ? [relative(root, path)] : [];
  });
}

/** Source without comments, so a comment that mentions a path proves nothing. */
function code(file: string): string {
  return readFileSync(join(root, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Which side of lib/ each import of `file` points at, whatever way the path is written. */
function importedSides(file: string): Set<"server" | "client"> {
  const sides = new Set<"server" | "client">();
  for (const [, specifier] of Array.from(code(file).matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g))) {
    const target = specifier.startsWith("@/")
      ? specifier.slice(2)
      : specifier.startsWith(".")
        ? normalize(join(dirname(file), specifier))
        : null;
    if (target?.startsWith("lib/server/")) sides.add("server");
    if (target?.startsWith("lib/client/")) sides.add("client");
  }
  return sides;
}

const server = sourceFiles("lib/server");
const client = sourceFiles("lib/client");
const shared = sourceFiles("lib").filter((file) => !server.includes(file) && !client.includes(file));
const browserCode = [...sourceFiles("components"), ...sourceFiles("hooks"), ...client, "app/page.tsx"];

describe("project structure", () => {
  it("has code on each side of lib/", () => {
    expect(server.length).toBeGreaterThan(0);
    expect(client.length).toBeGreaterThan(0);
    expect(shared.length).toBeGreaterThan(0);
    expect(sourceFiles("hooks").length).toBeGreaterThan(0);
  });

  it("sees the API route importing server code (the probe works)", () => {
    expect(Array.from(importedSides("app/api/analyze-parking/route.ts"))).toEqual(["server"]);
  });

  it.each(browserCode)("%s does not import server code", (file) => {
    expect(importedSides(file).has("server")).toBe(false);
  });

  it.each(server)("%s does not import browser code", (file) => {
    expect(importedSides(file).has("client")).toBe(false);
  });

  it.each(shared)("%s is usable from both sides", (file) => {
    expect(Array.from(importedSides(file))).toEqual([]);
  });

  it("reads the Azure settings only in server code", () => {
    const readers = [...sourceFiles("lib"), ...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("hooks")]
      .filter((file) => /process\.env/.test(code(file)));
    expect(readers.length).toBeGreaterThan(0);
    expect(readers.filter((file) => !file.startsWith("lib/server/"))).toEqual([]);
  });
});
