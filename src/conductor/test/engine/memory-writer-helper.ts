/**
 * Cross-process memory-write helper.
 *
 * Spawned as a child process via `vite-node` by the cross-process concurrency
 * test (`memory-store-concurrency.test.ts`).  Reads repository path, home, and
 * entry details from environment variables, calls `recordMemoryEntry` once, and
 * exits cleanly.
 *
 * The import uses the `.ts` extension because `vite-node` (invoked directly,
 * outside the vitest transform chain) resolves TypeScript sources via the `.ts`
 * path rather than the `.js`→`.ts` remapping that vitest's plugin provides.
 * This file is excluded from `tsconfig.json` (test/ is excluded), so the
 * non-standard `.ts` extension import does not affect `tsc --noEmit`.
 *
 * Required environment variables:
 *   FAKE_HOME    — directory to redirect HOME to (isolates the test store)
 *   REPO_PATH    — absolute path to the test git repository
 *   CATEGORY     — one of decisions | patterns | gotchas | context
 *   ENTRY_NAME   — file stem (no path separators allowed)
 *   ENTRY_BODY   — markdown body for the entry file
 *   INDEX_LINE   — line to append to index.md
 */

// vite-node resolves .ts imports directly; this file is excluded from tsc.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import { recordMemoryEntry } from '../../src/engine/memory-store.ts';

const { FAKE_HOME, REPO_PATH, CATEGORY, ENTRY_NAME, ENTRY_BODY, INDEX_LINE } = process.env;

if (!FAKE_HOME || !REPO_PATH || !CATEGORY || !ENTRY_NAME || !ENTRY_BODY || !INDEX_LINE) {
  process.stderr.write(
    'memory-writer-helper: missing required env vars ' +
      `(FAKE_HOME=${FAKE_HOME}, REPO_PATH=${REPO_PATH}, CATEGORY=${CATEGORY}, ` +
      `ENTRY_NAME=${ENTRY_NAME})\n`,
  );
  process.exit(1);
}

// Redirect HOME so the memory store lands in the test's isolated temp dir.
process.env.HOME = FAKE_HOME;

// eslint-disable-next-line @typescript-eslint/no-unsafe-call
await recordMemoryEntry(REPO_PATH, {
  category: CATEGORY,
  name: ENTRY_NAME,
  body: ENTRY_BODY,
  indexLine: INDEX_LINE,
});
