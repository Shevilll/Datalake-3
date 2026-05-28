// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // TypeScript already type-checks namespace/named imports (tsc --noEmit is green).
    // `import/namespace` + `import/named` cannot follow onnxruntime-common's multi-level
    // `export * from …` re-export chain and emit false-positive errors for ort.Tensor /
    // InferenceSession / env. typescript-eslint's own guidance is to disable these in TS
    // projects (redundant + slow); we rely on tsc for import correctness instead.
    rules: {
      "import/namespace": "off",
      "import/named": "off",
    },
  },
]);
