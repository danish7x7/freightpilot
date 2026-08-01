import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Generated + drift-checked in CI, never hand-edited, so never linted: src/api/*.gen.ts comes
  // from contracts/*.openapi.yaml and src/prompt/*.gen.ts from prompts/*.md. The prompt module is
  // embedded PROSE, so a future prompt with awkward escapes could otherwise redden `pnpm lint` on a
  // file nobody is permitted to edit by hand.
  { ignores: ["dist/**", "node_modules/**", "src/api/*.gen.ts", "src/prompt/*.gen.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
