import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-restricted-syntax": [
        "error",
        {
          selector: "Identifier[name=/^NEXT_PUBLIC_.*(SERVICE|SECRET|PRIVATE|SERVICE_ROLE)/i]",
          message: "Secrets must not be exposed with the NEXT_PUBLIC_ prefix (07 §8).",
        },
      ],
    },
  },
  // eslint-config-prettier must be last
  (await import("eslint-config-prettier")).default,
]);

export default eslintConfig;
