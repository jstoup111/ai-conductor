// Lints this plugin with the conductor engine's rule set (see
// src/conductor/eslint.config.mjs for the policy and per-rule rationale).
// typescript-eslint resolves from src/conductor, so run ESLint from there:
//   cd src/conductor && npx eslint --max-warnings=0 "../../plugins/*/**/*.ts"
import { promiseSafetyRules, tseslint } from '../../src/conductor/eslint.config.mjs';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  tseslint.configs.base,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: promiseSafetyRules,
  },
);
