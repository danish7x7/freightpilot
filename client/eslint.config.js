import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // src/api/*.gen.ts is generated from contracts/*.openapi.yaml (regenerated + drift-checked in CI); never hand-edited or linted.
  { ignores: ["dist/**", "node_modules/**", "src/api/*.gen.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
