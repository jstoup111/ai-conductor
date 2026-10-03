// Covers: task:1
import { chmod, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execa } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import { checkInventory, interpreterSourceInventory } from '../../scripts/check-interpreter-source.mts';
import * as gitHookAssets from '../../src/engine/git-hook-assets.js';

describe('interpreter-source inventory', () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

  async function root(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'interpreter-inventory-'));
    roots.push(directory);
    await mkdir(join(directory, 'bin'), { recursive: true });
    await mkdir(join(directory, 'hooks'), { recursive: true });
    await writeFile(join(directory, 'bin', 'safe'), '#!/bin/sh\nnode -e \'console.log(process.argv[1])\' -- "$VALUE"\n');
    return directory;
  }

  function modules(gitHooks: Record<string, unknown> = { SAFE: '#!/bin/sh\ntrue\n' }, sessionHooks: Record<string, unknown> = { SAFE: '#!/bin/sh\ntrue\n' }) {
    return { 'git-hook-assets': gitHooks, 'session-hook-assets': sessionHooks };
  }

  it('includes bundled skill helpers alongside every shipped bin and hook shell asset', async () => {
    await expect(interpreterSourceInventory(resolve(process.cwd(), '../..'))).resolves.toEqual([
      'bin/ai-conductor',
      'bin/generate-docs-guard-hook',
      'bin/generate-model-table',
      'bin/install',
      'bin/intake-backfill',
      'bin/lib/harness-common.sh',
      'bin/migrate',
      'bin/quarantine-engineer-signals',
      'bin/setup',
      'bin/update',
      'hooks/claude/block-destructive-git.sh',
      'hooks/claude/diagram-coverage-check.sh',
      'hooks/claude/docs-guard.sh',
      'hooks/claude/lint-after-edit.sh',
      'hooks/claude/post-commit-derive-feedback.sh',
      'hooks/claude/rate-limit-wait.sh',
      'hooks/claude/session-start-context.sh',
      'hooks/claude/spec-coverage-check.sh',
      'hooks/claude/stop-memory-reminder.sh',
      'hooks/claude/tdd-commit-gate.sh',
      'hooks/pre-commit-tdd-gate.sh',
      'skills/intake/scripts/intake-file',
    ]);
  });

  it('scans the real reference-transaction and pre-push generated hook exports without shell-expanded runtime data', async () => {
    expect(gitHookAssets.REFERENCE_TRANSACTION_HOOK).toMatch(/^#!\/bin\/bash\n/);
    expect(gitHookAssets.PRE_PUSH_HOOK).toMatch(/^#!\/bin\/bash\n/);
    await expect(checkInventory(await root())).resolves.toEqual([]);
  });

  it('reports an unsafe bundled skill helper', async () => {
    const directory = await root();
    await mkdir(join(directory, 'skills', 'demo', 'scripts'), { recursive: true });
    await writeFile(join(directory, 'skills', 'demo', 'scripts', 'tool'), '#!/bin/sh\npython3 -c "print($SECRET)"\n');
    await expect(checkInventory(directory, modules())).resolves.toEqual([
      expect.objectContaining({ sourceName: 'skills/demo/scripts/tool', line: 2 }),
    ]);
  });

  it('succeeds for bin and hook assets when skills is absent', async () => {
    const directory = await root();
    await writeFile(join(directory, 'hooks', 'safe-hook'), '#!/bin/sh\ntrue\n');
    await expect(checkInventory(directory, modules())).resolves.toEqual([]);
  });

  it('scans unsafe shipped files but excludes documentation and test specimens', async () => {
    const directory = await root();
    await writeFile(join(directory, 'bin', 'unsafe'), '#!/bin/sh\npython3 -c "print($SECRET)"\n');
    await mkdir(join(directory, 'docs'), { recursive: true });
    await writeFile(join(directory, 'docs', 'unsafe.md'), 'python3 -c "print($SECRET)"\n');
    await expect(checkInventory(directory, modules())).resolves.toEqual([
      expect.objectContaining({ sourceName: 'bin/unsafe', line: 2 }),
    ]);
  });

  it.each([
    ['unclassified export', modules({ SAFE: '#!/bin/sh\ntrue\n', build: () => 'safe' }), /unclassified/],
    ['empty generated inventory', modules({}), /inventory is empty/],
  ])('fails closed for %s', async (_name, modules, message) => {
    await expect(checkInventory(await root(), modules)).rejects.toThrow(message);
  });

  it('fails closed when the generated-hook module loader fails', async () => {
    await expect(checkInventory(await root(), modules(), async () => { throw new Error('controlled loader failure'); }))
      .rejects.toThrow('controlled loader failure');
  });

  it.each(['git-hook-assets', 'session-hook-assets'])('reports unsafe rendered source from %s exports', async (moduleName) => {
    await expect(checkInventory(await root(), modules(
      moduleName === 'git-hook-assets' ? { SAFE: '#!/bin/sh\ntrue\n', UNSAFE: 'python3 -c "print($SECRET)"\n' } : undefined,
      moduleName === 'session-hook-assets' ? { SAFE: '#!/bin/sh\ntrue\n', UNSAFE: 'python3 -c "print($SECRET)"\n' } : undefined,
    ))).resolves.toEqual([
      expect.objectContaining({ sourceName: `${moduleName}#UNSAFE`, line: 1, message: 'shell expansion in interpreter command source' }),
    ]);
  });

  it('fails closed for an empty file inventory and required file reads', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'interpreter-empty-'));
    roots.push(empty);
    await mkdir(join(empty, 'bin'));
    await mkdir(join(empty, 'hooks'));
    await expect(checkInventory(empty, modules())).rejects.toThrow(/inventory is empty/);
    const directory = await root();
    await chmod(join(directory, 'bin', 'safe'), 0o000);
    const result = await execa('node', ['--import', 'tsx', 'scripts/check-interpreter-source.mts', directory], {
      cwd: process.cwd(), reject: false,
    });
    expect(result.exitCode).not.toBe(0);
  });

  it('scans shell entrypoints but ignores non-shell bin files and fails for a missing generated namespace', async () => {
    const directory = await root();
    await writeFile(join(directory, 'bin', 'unsafe.py'), 'python3 -c "print($IGNORED)"\n');
    await writeFile(join(directory, 'bin', 'unsafe-shell'), '#!/usr/bin/env bash\npython3 -c "print($FOUND)"\n');
    await expect(checkInventory(directory, modules())).resolves.toEqual([
      expect.objectContaining({ sourceName: 'bin/unsafe-shell', line: 2 }),
    ]);
    await expect(checkInventory(directory, { 'git-hook-assets': { SAFE: 'true\n' } })).rejects.toThrow(/session-hook-assets generated-hook module is missing/);
  });
});
