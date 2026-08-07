import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: vi.fn(actual.rename),
  };
});

import { rename } from 'node:fs/promises';
import {
  classifyBuildSettle,
  readBuildOutcome,
  sameNoOpCycle,
  writeBuildOutcome,
  type BuildOutcomeRecord,
} from '../../src/engine/build-outcome.js';

const priorOutcome = (overrides: Partial<BuildOutcomeRecord> = {}): BuildOutcomeRecord => ({
  outcome: 'no-movement',
  terminalOutcome: 'done',
  gate: 'wiring_check',
  treeBefore: 'tree-0',
  treeAfter: 'tree-1',
  headBefore: 'head-0',
  headAfter: 'head-1',
  verdict: false,
  rung: { model: 'gpt-5.6-terra', effort: 'medium' },
  ...overrides,
});

describe('classifyBuildSettle', () => {
  it.each([
    ['moved when non-null tree hashes differ', 'before-tree', 'after-tree', 2, 2, 'moved'],
    ['no-movement when tree hashes match', 'same-tree', 'same-tree', 2, 2, 'no-movement'],
    ['moved when resolved work increases despite matching trees', 'same-tree', 'same-tree', 2, 3, 'moved'],
  ] as const)('%s', (_description, treeBefore, treeAfter, resolvedBefore, resolvedAfter, expected) => {
    expect(
      classifyBuildSettle({ treeBefore, treeAfter, resolvedBefore, resolvedAfter }),
    ).toBe(expected);
  });

  it.each([
    ['treeBefore is null', null, 'after-tree'],
    ['treeAfter is null', 'before-tree', null],
    ['both tree hashes are null', null, null],
  ] as const)('returns no-movement when %s', (_description, treeBefore, treeAfter) => {
    expect(
      classifyBuildSettle({ treeBefore, treeAfter, resolvedBefore: 2, resolvedAfter: 3 }),
    ).toBe('no-movement');
  });

  it.each([
    ['matches a prior no-movement outcome', priorOutcome(), true],
    ['rejects a different tree', priorOutcome({ treeAfter: 'tree-2' }), false],
    ['rejects a different gate', priorOutcome({ gate: 'test_suite' }), false],
    ['rejects a different verdict', priorOutcome({ verdict: true }), false],
    ['rejects a different rung', priorOutcome({ rung: { model: 'gpt-5.6-terra', effort: 'high' } }), false],
    ['rejects a prior moved outcome', priorOutcome({ outcome: 'moved' }), false],
    ['rejects an absent prior outcome', null, false],
  ] as const)('%s', (_description, prior, expected) => {
    expect(
      sameNoOpCycle(prior, {
        gate: 'wiring_check',
        treeHash: 'tree-1',
        verdict: false,
        rung: { model: 'gpt-5.6-terra', effort: 'medium' },
      }),
    ).toBe(expected);
  });

  it.each([
    ['a null prior tree witness', priorOutcome({ treeAfter: null }), 'tree-1', priorOutcome().rung],
    ['a null current tree witness', priorOutcome(), null, priorOutcome().rung],
    ['null tree witnesses on both outcomes', priorOutcome({ treeAfter: null }), null, priorOutcome().rung],
    [
      'a changed rung',
      priorOutcome({ rung: { model: 'sonnet', effort: 'medium' } }),
      'tree-1',
      { model: 'opus', effort: 'high' },
    ],
  ] as const)('rejects %s', (_description, prior, treeHash, rung) => {
    expect(
      sameNoOpCycle(prior, {
        gate: 'wiring_check',
        treeHash,
        verdict: false,
        rung,
      }),
    ).toBe(false);
  });

  it('does not import the retired build-progress classifier', () => {
    expect(
      readFileSync(new URL('../../src/engine/build-outcome.ts', import.meta.url), 'utf8'),
    ).not.toMatch(/import\s+(?:type\s+)?[\s\S]*?\bclassifyBuildProgress\b/);
  });
});

describe('readBuildOutcome', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-outcome-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns an empty record set when the sidecar is absent', async () => {
    await expect(readBuildOutcome(dir)).resolves.toEqual({ version: 1, records: [] });
  });

  it.each([
    ['invalid JSON', 'not valid json {'],
    ['an unsupported version', JSON.stringify({ version: 2, records: [] })],
    ['a record that fails the shape guard', JSON.stringify({ version: 1, records: [{ outcome: 'moved' }] })],
  ])('returns an empty record set and warns once for %s', async (_description, contents) => {
    const sidecarPath = join(dir, '.pipeline', 'build-outcome.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(sidecarPath, contents);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(readBuildOutcome(dir)).resolves.toEqual({ version: 1, records: [] });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(sidecarPath));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('returns an empty record set and warns once when the sidecar path is unreadable', async () => {
    const sidecarPath = join(dir, '.pipeline', 'build-outcome.json');
    await mkdir(sidecarPath, { recursive: true });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await expect(readBuildOutcome(dir)).resolves.toEqual({ version: 1, records: [] });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(sidecarPath));
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('writeBuildOutcome', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-outcome-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('writes to a temp file before atomically renaming it into place', async () => {
    await writeBuildOutcome(dir, { version: 1, records: [priorOutcome()] });

    const sidecarPath = join(dir, '.pipeline', 'build-outcome.json');
    const renameMock = vi.mocked(rename);
    expect(renameMock).toHaveBeenCalledTimes(1);
    expect(renameMock).toHaveBeenCalledWith(
      expect.stringMatching(/\.build-outcome\.[^.]+\.[^.]+\.tmp$/),
      sidecarPath,
    );
    await expect(readBuildOutcome(dir)).resolves.toEqual({ version: 1, records: [priorOutcome()] });
  });

  it('removes the temp file and leaves no partial sidecar when rename fails', async () => {
    const renameError = new Error('simulated rename failure');
    vi.mocked(rename).mockRejectedValueOnce(renameError);

    await expect(writeBuildOutcome(dir, { version: 1, records: [priorOutcome()] })).rejects.toThrow(renameError);

    const pipelineDir = join(dir, '.pipeline');
    await expect(readdir(pipelineDir)).resolves.toEqual([]);
    await expect(readBuildOutcome(dir)).resolves.toEqual({ version: 1, records: [] });
  });
});
