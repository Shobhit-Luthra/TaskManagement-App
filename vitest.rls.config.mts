import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

function loadDotEnvTest(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(".env.test", "utf8")
        .split("\n")
        .filter((line) => line.includes("=") && !line.trimStart().startsWith("#"))
        .map((line) => {
          const separator = line.indexOf("=");
          return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
        }),
    );
  } catch {
    return {};
  }
}

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/test/rls/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: process.env.NEXT_PUBLIC_SUPABASE_URL ? {} : loadDotEnvTest(),
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
});
