import js from "@eslint/js";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...globals.browser, THREE: "readonly" } },
    rules: {
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
      "no-redeclare": "error",
      "no-shadow": ["error", { hoist: "functions" }],
      "eqeqeq": ["error", "always", { null: "ignore" }],
      "no-var": "off"
    }
  },
  {
    files: ["test/**/*.js", "eslint.config.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...globals.node } },
    rules: { "no-unused-vars": ["error", { args: "none" }] }
  },
  { ignores: ["node_modules/"] }
];
