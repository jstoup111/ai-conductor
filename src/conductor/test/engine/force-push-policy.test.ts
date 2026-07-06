/**
 * Force-push policy invariant (T13 / TS-4 Done When, adr-2026-07-03-pr-timing-config-key).
 *
 * Purpose: mechanically pin the force-push policy documented at T11's call
 * site (`src/engine/conductor.ts` `runRebasePublishHook`): `--force-with-lease`
 * is the ONLY force-push construct anywhere in `src/conductor/src`, and a bare
 * `git push --force` never appears as an actual push invocation. This is a
 * static grep-level check over source text (not runtime behavior — T11/T12
 * already pin that behaviorally); it exists purely to catch a future PR that
 * accidentally introduces a second, less-safe force-push site.
 */

import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = join(__dirname, '../../src');

interface Match {
  file: string;
  line: number;
  text: string;
}

/** Recursively collect every `.ts` file path under `root`. */
async function collectTsFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTsFiles(full)));
    } else if (entry.isFile() && full.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

async function grepSrc(pattern: RegExp): Promise<Match[]> {
  const files = await collectTsFiles(SRC_ROOT);
  const matches: Match[] = [];
  for (const file of files) {
    const content = await readFile(file, 'utf-8');
    const lines = content.split('\n');
    lines.forEach((text, idx) => {
      if (pattern.test(text)) {
        matches.push({ file, line: idx + 1, text: text.trim() });
      }
    });
  }
  return matches;
}

describe('force-push policy invariant (T13, grep-level)', () => {
  it('`--force-with-lease` string-literal push arg appears at exactly two sanctioned call sites', async () => {
    // Matches the actual argv-array literal (single-quoted string literal),
    // not doc-comment prose that merely mentions the flag in backticks.
    const matches = await grepSrc(/'--force-with-lease'/);

    // Two sanctioned force-with-lease call sites: T11 (pr-labels) and autoresolve T12
    // (ADR-2026-07-04-widen-rebase-resolution-dispatch-to-sweep).
    expect(matches).toHaveLength(2);

    const prLabelsMatch = matches.find((m) =>
      m.file.endsWith('src/engine/pr-labels.ts')
    );
    const autoresolveMatch = matches.find((m) =>
      m.file.endsWith('src/engine/autoresolve.ts')
    );

    expect(prLabelsMatch).toBeDefined();
    expect(prLabelsMatch?.text).toContain("['push', '--force-with-lease', 'origin', branch]");

    expect(autoresolveMatch).toBeDefined();
    expect(autoresolveMatch?.text).toContain('--force-with-lease');
  });

  it('a bare `--force` string-literal argument never appears alongside a `push` invocation', async () => {
    // `--force` legitimately appears elsewhere (worktree remove, gh label
    // create) — those are fine. What must NEVER exist is `push` combined with
    // a bare (non-lease) `--force` in the same argv array literal.
    const forceLiterals = await grepSrc(/'--force'/);

    const bareForcePush = forceLiterals.filter((m) => /push/.test(m.text));
    expect(bareForcePush).toHaveLength(0);
  });

  it('every `--force` string-literal site is a non-push git/gh operation (worktree remove or label create)', async () => {
    const forceLiterals = await grepSrc(/'--force'/);

    expect(forceLiterals.length).toBeGreaterThan(0); // sanity: the pattern exists elsewhere in the codebase
    for (const m of forceLiterals) {
      expect(m.text).toMatch(/worktree.*remove|label.*create/);
    }
  });
});
