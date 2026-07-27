// Type-aware ESLint for the conductor engine.
//
// Deliberately NOT a stock preset. `strict: true` in tsconfig.json already covers
// the stylistic and basic-correctness ground a preset would add, so a preset here
// is pure noise across ~85k lines. The rules below are limited to the class of bug
// `tsc` structurally cannot find: promises that are created and then dropped.
//
// This is an async daemon built on execa/chokidar. A dropped promise does not throw
// — it presents as a silent stall, which is this repository's dominant failure mode.
//
// POLICY: errors only, never warnings. Every rule below is `error`; a rule too noisy
// to run at `error` is turned off outright and recorded here with the reason. There
// is no advisory tier — a warning nobody reads only teaches people to ignore the
// tool. `npm run lint` additionally passes `--max-warnings=0`.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'scripts/**', '*.config.ts', '*.mjs'],
  },
  tseslint.configs.base,
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    languageOptions: {
      parserOptions: {
        // tsconfig.test.json, NOT tsconfig.json — the latter excludes `test/`, so
        // the project service cannot resolve a single test file and every one of
        // the 599 reports as "not found by the project service" instead of being
        // linted. tsconfig.test.json includes src/ and test/, so one project
        // covers the whole linted surface.
        project: ['./tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      // The repo carries a few eslint-disable comments from before ESLint existed
      // here; they refer to rules this config does not enable.
      reportUnusedDisableDirectives: 'off',
    },
    rules: {
      // A promise created and never consumed. This is the rule the whole config
      // exists for: it is the silent-stall bug class, and the baseline is clean,
      // so it is enforced at `error` to keep it that way.
      '@typescript-eslint/no-floating-promises': 'error',

      // `await` on a non-thenable — always either a bug or dead code.
      '@typescript-eslint/await-thenable': 'error',

      // `checksVoidReturn.arguments` is disabled deliberately. With it on, the rule
      // fires 90 times, and every single hit is the same shape: an async callback
      // handed to a void-return API (`process.on('SIGINT', asyncHandler)`,
      // commander `.action()`). Node genuinely ignores those return values, so the
      // only available "fix" is a `void` wrapper that changes nothing at runtime
      // and hides the rejection path instead of handling it. The remaining
      // sub-checks (conditionals, spreads, return positions) stay on — those are
      // unambiguous bugs. See PR body for the deferred-count breakdown.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { arguments: false } },
      ],

      // NOT enabled: `require-await`. It reports 40 times, and the dominant shape
      // is an `async` function that conforms to an awaited interface without
      // needing `await` itself (`onCheckpoint ?? (async () => 'continue')`,
      // `async function hasSession(): Promise<boolean>`). Dropping `async` there
      // would change the declared contract, not fix a defect.
      // '@typescript-eslint/require-await': 'error',
    },
  },
);
