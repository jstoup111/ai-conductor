// Tests for the `conduct-ts overlap-scan` subcommand (Task 7).
// Covers: CLI surface registration, argv detection, and real dispatch
// (real makeGitRunner + real createBlockerResolver) against a scratch repo.

import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileP('git', args, { cwd });
}

async function makeScratchRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'overlap-scan-cli-'));
  await git(dir, ['init', '-q']);
  await git(dir, ['config', 'user.email', 'test@example.com']);
  await git(dir, ['config', 'user.name', 'Test']);
  await writeFile(join(dir, 'base.txt'), 'base\n');
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-q', '-m', 'base commit']);
  await git(dir, ['branch', '-M', 'main']);
  return dir;
}

// ─── 1. Structural: `createProgram()` registers an `overlap-scan` subcommand ─

describe('CLI surface — conduct-ts overlap-scan subcommand (Task 7)', () => {
  it('createProgram() exposes an `overlap-scan` subcommand', async () => {
    const { createProgram } = await import('../../src/index.js');
    const names = createProgram()
      .commands.map((c) => c.name())
      .sort();
    expect(names).toContain('overlap-scan');
  });

  it('overlap-scan subcommand declares --files, --source-ref, --base, --cwd', async () => {
    const { createProgram } = await import('../../src/index.js');
    const cmd = createProgram().commands.find((c) => c.name() === 'overlap-scan');
    expect(cmd).toBeDefined();
    const optionFlags = (cmd?.options ?? []).map((o) => o.long);
    expect(optionFlags).toContain('--files');
    expect(optionFlags).toContain('--source-ref');
    expect(optionFlags).toContain('--base');
    expect(optionFlags).toContain('--cwd');
  });
});

// ─── 2. Detection: detectOverlapScanCommand matches argv[2] === 'overlap-scan' ─

describe('detectOverlapScanCommand — argv detection', () => {
  it('parses --files, --source-ref, --base, --cwd', async () => {
    const { detectOverlapScanCommand } = await import('../../src/index.js');
    const result = detectOverlapScanCommand([
      'node',
      'conduct-ts',
      'overlap-scan',
      '--files',
      'a.ts,b.ts',
      '--source-ref',
      'owner/repo#5',
      '--base',
      'main',
      '--cwd',
      '/tmp/some-repo',
    ]);
    expect(result).not.toBeNull();
    expect(result?.files).toEqual(['a.ts', 'b.ts']);
    expect(result?.sourceRef).toBe('owner/repo#5');
    expect(result?.base).toBe('main');
    expect(result?.cwd).toBe('/tmp/some-repo');
  });

  it('returns null for non-overlap-scan argv', async () => {
    const { detectOverlapScanCommand } = await import('../../src/index.js');
    expect(detectOverlapScanCommand(['node', 'conduct-ts', 'daemon'])).toBeNull();
    expect(detectOverlapScanCommand(['node', 'conduct-ts'])).toBeNull();
  });
});

// ─── 3. Dispatch: real runners, exits 0 even with advisory skip notes ────────

describe('overlapScanCommand — real dispatch', () => {
  it('drives runOverlapScan with real git/gh runners, prints renderReport, exits 0', async () => {
    const { overlapScanCommand, detectOverlapScanCommand } = await import('../../src/index.js');
    const dir = await makeScratchRepo();
    try {
      // A sibling spec/* branch overlapping our candidate file `base.txt`.
      await git(dir, ['checkout', '-q', '-b', 'spec/sibling-feature']);
      await writeFile(join(dir, 'base.txt'), 'base\nchanged by sibling\n');
      await git(dir, ['add', '.']);
      await git(dir, ['commit', '-q', '-m', 'sibling touches base.txt']);
      await git(dir, ['checkout', '-q', 'main']);

      const cmd = detectOverlapScanCommand([
        'node',
        'conduct-ts',
        'overlap-scan',
        '--files',
        'base.txt',
        // No linked issue — sourceRef omitted so the blocker sweep is a
        // no-op and no real `gh` network call happens in this test.
        '--base',
        'main',
        '--cwd',
        dir,
      ]);
      expect(cmd).not.toBeNull();

      const printed: string[] = [];
      const code = await overlapScanCommand(cmd!, { print: (s: string) => printed.push(s) });

      expect(code).toBe(0);
      expect(printed.join('\n')).toContain('spec/sibling-feature');
      expect(printed.join('\n')).toContain('base.txt');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('exits 0 even when the report carries an advisory-skip note (unresolvable base)', async () => {
    const { overlapScanCommand, detectOverlapScanCommand } = await import('../../src/index.js');
    const dir = await makeScratchRepo();
    try {
      const cmd = detectOverlapScanCommand([
        'node',
        'conduct-ts',
        'overlap-scan',
        '--files',
        'base.txt',
        '--base',
        'no-such-base-ref',
        '--cwd',
        dir,
      ]);
      expect(cmd).not.toBeNull();

      const printed: string[] = [];
      const code = await overlapScanCommand(cmd!, { print: (s: string) => printed.push(s) });

      // Advisory — never blocks authoring, even on a degraded/skip result.
      expect(code).toBe(0);
      expect(printed.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
