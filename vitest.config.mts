import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

const alias = { "@": path.resolve(import.meta.dirname, "./src") };
const exclude = ["e2e/**", "node_modules/**", "src/test/rls/**"];

// Only component tests (and hook tests under src/components) need a DOM. Plain .ts tests run in node, which avoids building a jsdom
// window for every file.
export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.{ts,tsx}"],
      exclude: ["src/lib/**/*.test.{ts,tsx}", "src/test/**"],
      thresholds: { lines: 70, statements: 70, functions: 70, branches: 60 },
      reporter: ["text", "lcov"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          include: ["src/**/*.{test,spec}.tsx", "src/components/**/*.{test,spec}.ts"],
          exclude,
        },
      },
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.{test,spec}.ts"],
          exclude: [...exclude, "src/components/**"],
        },
      },
    ],
  },
});
