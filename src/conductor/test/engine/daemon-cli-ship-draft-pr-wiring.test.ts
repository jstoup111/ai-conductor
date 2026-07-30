import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('daemon-cli SHIP draft PR branch wiring', () => {
  it('passes the discovered worktree branch to the production Conductor assembly', async () => {
    const source = await readFile(new URL('../../src/daemon-cli.ts', import.meta.url), 'utf8');

    const wiresBranch =
      /new\s+Conductor\s*\(\s*\{(?:(?!^\s*\}\s*\);)[\s\S]){0,8000}?\bworktreeBranch\s*:\s*wt\.branch\b/m.test(
        source,
      );

    expect(
      wiresBranch,
      'expected new Conductor({...}) to include worktreeBranch: wt.branch',
    ).toBe(true);
  });
});
