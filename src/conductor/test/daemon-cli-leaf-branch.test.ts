// Covers: task:10
// ─────────────────────────────────────────────────────────────────────────────
// Task 10 — daemon-cli builds the shipped-record probe branch and the CI-fix
// head ref through the single leaf-name authority (`leafBranchFor`) instead of
// hand-rolling a `feat/daemon-${slug}` template literal.
//
// The behavioral sweep/deps tests prove the leaf names are correct; this
// source-assembly check pins the daemon-cli sites so they cannot silently drift
// back to an inline template that the identity module does not own.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const DAEMON_CLI_SRC = fileURLToPath(new URL('../src/daemon-cli.ts', import.meta.url));

describe('daemon-cli leaf branch construction', () => {
  it('imports leafBranchFor and uses it at both template sites with no feat/daemon- literal left', async () => {
    const source = await readFile(DAEMON_CLI_SRC, 'utf-8');

    expect(source).toMatch(
      /import\s*\{\s*leafBranchFor\s*\}\s*from\s*['"]\.\/engine\/feature-branch-identity\.js['"]/,
    );

    // Shipped-record dedup probe branch.
    expect(source).toContain('const branch = leafBranchFor(slug);');

    // CI-fix halt-PR operations head ref.
    expect(source).toContain('headRefName: leafBranchFor(entry.slug),');

    // No inline `feat/daemon-${…}` template survives anywhere in the file.
    expect(source).not.toContain('feat/daemon-');
  });
});