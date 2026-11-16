import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["dist/**", "node_modules/**", "data/**"] },
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx}"],
    ...react.configs.flat.recommended,
    ...react.configs.flat["jsx-runtime"],
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      globals: { ...globals.browser },
    },
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat["jsx-runtime"].rules,
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react/prop-types": "off",
      "react/no-unescaped-entities": "off",
      // Colours come from styles/tokens.css through a class, never from a
      // component: that is what keeps both themes correct.
      "no-restricted-syntax": ["error", {
        selector: "Literal[value=/^#[0-9a-fA-F]{3,8}$/]",
        message: "Hex colour in a component; use a token through a class (styles/tokens.css).",
      }],
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["server/**/*.js", "shared/**/*.js", "*.config.js"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // Prompt text in template literals uses no-break spaces on purpose.
      "no-irregular-whitespace": ["error", { skipTemplates: true, skipStrings: true, skipRegExps: true }],
      "no-useless-escape": "off",
    },
  },
  {
    files: ["**/__tests__/**", "**/*.test.{js,jsx}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
