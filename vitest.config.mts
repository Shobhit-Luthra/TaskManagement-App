import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", "src/test/rls/**"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.{ts,tsx}"],
      exclude: ["src/lib/**/*.test.{ts,tsx}", "src/test/**"],
      thresholds: { lines: 70, statements: 70, functions: 70, branches: 60 },
      reporter: ["text", "lcov"],
    },
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
});
