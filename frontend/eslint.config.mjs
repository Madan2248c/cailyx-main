import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Vendored Animate UI source (installed via `shadcn add @animate-ui/...`).
  // Kept as upstream ships it so future updates apply cleanly; it predates
  // the React Compiler lint rules below, which it trips on purpose (measured
  // layout and spring state).
  {
    files: [
      "components/animate-ui/**",
      // Hooks the Animate UI registry installs next to ours (listed by name so
      // our own hooks stay under the full rule set).
      "hooks/use-auto-height.tsx",
      "hooks/use-controlled-state.tsx",
      "hooks/use-is-in-view.tsx",
      "hooks/use-motion-value-state.tsx",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/static-components": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
