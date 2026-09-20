import globals from "globals";
import pluginJs from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";

// The TypeScript parser and plugin are wired up directly instead of through the
// `typescript-eslint` convenience wrapper — same rules, one fewer dependency,
// and the coupling to the compiler stays visible. That coupling is real: every
// @typescript-eslint package refuses to load against TypeScript 7, so the
// project pins typescript to 6.x — the last JS-API line, and the newest thing
// the lint toolchain can read. Bumping typescript to 7 breaks `pnpm lint`
// outright until upstream catches up; the build itself is happy either way.
// Tracking: https://github.com/typescript-eslint/typescript-eslint/issues/10940

/** @type {import('eslint').Linter.Config[]} */
export default [
  // Build output is generated, not authored.
  { ignores: ["dist/**"] },
  { files: ["**/*.{js,mjs,cjs,ts}"] },
  { languageOptions: { globals: globals.browser } },
  pluginJs.configs.recommended,
  ...tsPlugin.configs["flat/recommended"],

  // The game runs in the browser; the clip-generation scripts in tools/ run in
  // Node and legitimately reach for process, Buffer and friends.
  {
    files: ["tools/**/*.js"],
    languageOptions: { globals: { ...globals.node } },
  },

  // A parameter an override needs but a base/default implementation does not
  // (PhasedArrayAntenna.scanAngleDeg reads shipDirection, Antenna's own
  // implementation does not, but both must share the signature) is not dead
  // code — it is still part of the interface. Leading underscore marks that
  // intentionally, same convention as elsewhere in the TS ecosystem.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
