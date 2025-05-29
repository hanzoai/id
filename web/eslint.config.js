const babelParser = require("@babel/eslint-parser");
const pluginReact = require("eslint-plugin-react");
const pluginCypress = require("eslint-plugin-cypress");
const pluginUnusedImports = require("eslint-plugin-unused-imports");
const globals = require("globals");

module.exports = [
  {
    files: ["**/*.{js,jsx,mjs,cjs}"],
    languageOptions: {
      parser: babelParser,
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021,
        ...globals.cypress,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
          flow: true,
        },
        requireConfigFile: false,
        babelOptions: {
          babelrc: false,
          configFile: false,
          presets: ["@babel/preset-react"],
        },
      },
    },
    plugins: {
      react: pluginReact,
      cypress: pluginCypress,
      "unused-imports": pluginUnusedImports,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      semi: ["error", "always"],
      indent: ["error", 2],
      quotes: ["error", "double"],
      "jsx-quotes": ["error", "prefer-double"],
      "space-in-parens": ["error", "never"],
      "object-curly-spacing": ["error", "never"],
      "array-bracket-spacing": ["error", "never"],
      "comma-spacing": ["error", {before: false, after: true}],
      "react/jsx-curly-spacing": [
        "error",
        {when: "never", allowMultiline: true, children: true},
      ],
      "arrow-spacing": ["error", {before: true, after: true}],
      "space-before-blocks": ["error", "always"],
      "spaced-comment": ["error", "always"],
      "react/jsx-tag-spacing": ["error", {beforeSelfClosing: "always"}],
      "block-spacing": ["error", "never"],
      "space-before-function-paren": ["error", "never"],
      "no-trailing-spaces": ["error", {ignoreComments: true}],
      "eol-last": ["error", "always"],
      "no-var": "error",
      "prefer-const": ["error", {destructuring: "all"}],
      curly: ["error", "all"],
      "brace-style": ["error", "1tbs", {allowSingleLine: true}],
      "no-mixed-spaces-and-tabs": "error",
      "sort-imports": ["error", {ignoreDeclarationSort: true}],
      "no-multiple-empty-lines": ["error", {max: 1, maxBOF: 0, maxEOF: 0}],
      "space-unary-ops": ["error", {words: true, nonwords: false}],
      "space-infix-ops": "error",
      "key-spacing": ["error", {beforeColon: false, afterColon: true}],
      "comma-style": ["error", "last"],
      "comma-dangle": [
        "error",
        {
          arrays: "always-multiline",
          objects: "always-multiline",
          imports: "never",
          exports: "never",
          functions: "never",
        },
      ],
      "no-multi-spaces": ["error", {ignoreEOLComments: true}],
      "react/no-unknown-property": ["error", {ignore: ["css"]}],
      "unused-imports/no-unused-imports": "off",
      "unused-imports/no-unused-vars": [
        "error",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "none",
          argsIgnorePattern: "^_",
        },
      ],
      "no-unused-vars": "off",
      "react/no-deprecated": "error",
      "react/jsx-key": "error",
      "no-console": "error",
      eqeqeq: "error",
      "keyword-spacing": "error",
      "react/prop-types": "off",
      "react/display-name": "off",
      "react/react-in-jsx-scope": "off",
      "no-case-declarations": "off",
    },
  },
];
