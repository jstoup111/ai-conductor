import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';
import {
  HALT_RECORD_DIR,
  haltRecordPath,
  isRecordableHaltClass,
  recordHalt,
  renderHaltRecord,
  resolveRecordability,
  supersedeHaltRecord,
  supersedeHaltRecordText,
} from '../../src/engine/halt-record.js';

const input = {
  slug: 'operator-decision',
  haltClass: 'needs-human',
  step: 'build_review',
  phase: 'BUILD',
  branch: 'feat/operator-decision',
  headSha: 'f00dbabe1234567890',
  haltedAt: '2026-08-23T16:30:00.000Z',
  haltBody: 'Build review needs an operator decision.\nThe release note scope is unclear.',
} as const;

describe('halt record rendering', () => {
  it('renders every operator pickup field for a halted feature', () => {
    expect(renderHaltRecord(input)).toBe(
      '# Halt record\n\n' +
        'Status: halted\n' +
        'Slug: operator-decision\n' +
        'Class: needs-human\n' +
        'Halting step: build_review\n' +
        'Phase: BUILD\n' +
        'Branch: feat/operator-decision\n' +
        'Head SHA: f00dbabe1234567890\n' +
        'Halted at: 2026-08-23T16:30:00.000Z\n\n' +
        'Push status: this record may be ahead of the remote; push is not guaranteed.\n\n' +
        '## HALT\n\n' +
        '```text\n' +
        'Build review needs an operator decision.\nThe release note scope is unclear.\n' +
        '```\n',
    );
  });

  it('uses a fence that preserves a HALT body containing a fence delimiter', () => {
    const haltBody = 'first line\n```\nembedded delimiter\n````';
    const record = renderHaltRecord({ ...input, haltBody });

    expect(record).toContain(`\`\`\`\`\`text\n${haltBody}\n\`\`\`\`\``);
  });

  it('warns that the record may be ahead of the remote', () => {
    expect(renderHaltRecord(input)).toContain(
      'Push status: this record may be ahead of the remote; push is not guaranteed.\n',
    );
  });

  it('is byte-identical for identical input and resolves the record path', () => {
    const first = renderHaltRecord(input);
    const second = renderHaltRecord(input);

    expect(first).toBe(second);
    expect(haltRecordPath(input.slug)).toBe(`${HALT_RECORD_DIR}/operator-decision.md`);
  });
});

describe('halt record supersession', () => {
  it('resolves a halted record while preserving its halt history', () => {
    const superseded = supersedeHaltRecordText(renderHaltRecord(input), {
      cause: 'operator resume',
      resolvedAt: '2026-08-23T17:00:00.000Z',
    });

    expect(superseded).toBe(
      '# Halt record\n\n' +
        'Status: resolved\n' +
        'Resolution cause: operator resume\n' +
        'Resolved at: 2026-08-23T17:00:00.000Z\n' +
        'Slug: operator-decision\n' +
        'Class: needs-human\n' +
        'Halting step: build_review\n' +
        'Phase: BUILD\n' +
        'Branch: feat/operator-decision\n' +
        'Head SHA: f00dbabe1234567890\n' +
        'Halted at: 2026-08-23T16:30:00.000Z\n\n' +
        'Push status: this record may be ahead of the remote; push is not guaranteed.\n\n' +
        '## HALT\n\n' +
        '```text\n' +
        'Build review needs an operator decision.\nThe release note scope is unclear.\n' +
        '```\n',
    );
  });

  it('leaves an already-resolved record byte-identical', () => {
    const resolved = supersedeHaltRecordText(
      'Status: resolved\nResolution cause: operator resume\nResolved at: 2026-08-23T17:00:00.000Z\n',
      { cause: 'rekick', resolvedAt: '2026-08-23T18:00:00.000Z' },
    );

    expect(resolved).toBe('Status: resolved\nResolution cause: operator resume\nResolved at: 2026-08-23T17:00:00.000Z\n');
  });

  it('commits a resolution once when superseded repeatedly', async () => {
    const root = await makeFeatureRepository();
    await recordHalt(root, input);
    const before = await commitCount(root);

    await expect(supersedeHaltRecord(root, input.slug, 'operator resume')).resolves.toEqual({ kind: 'written' });
    await expect(supersedeHaltRecord(root, input.slug, 'rekick')).resolves.toEqual({ kind: 'noop' });

    expect(await commitCount(root)).toBe(before + 1);
  });

  it('returns a failure result when the record cannot be read', async () => {
    const root = await makeFeatureRepository();

    await expect(supersedeHaltRecord(root, input.slug, 'operator resume')).resolves.toMatchObject({ kind: 'failed' });
  });
});

const scratchRoots: string[] = [];

afterEach(async () => {
  while (scratchRoots.length > 0) {
    await rm(scratchRoots.pop()!, { recursive: true, force: true });
  }
});

describe('halt recordability', () => {
  it('records only operator-actionable halt classes', () => {
    expect([
      isRecordableHaltClass('mechanical'),
      isRecordableHaltClass('needs-human'),
      isRecordableHaltClass('plan-gap'),
      isRecordableHaltClass('protected-artifact'),
    ]).toEqual([false, true, true, true]);
  });

  it('does not record a halt from the repository default branch', async () => {
    const root = await makeScratchRepository();

    await expect(resolveRecordability(root, 'needs-human')).resolves.toBe(false);
  });

  it('records an operator-actionable halt from a feature worktree', async () => {
    const root = await makeScratchRepository();
    const worktree = join(root, '..', 'halt-record-feature-worktree');
    scratchRoots.push(worktree);
    await execa('git', ['worktree', 'add', '-q', '-b', 'feat/operator-decision', worktree], { cwd: root });

    await expect(resolveRecordability(worktree, 'needs-human')).resolves.toBe(true);
  });

  it('fails closed when branch resolution throws', async () => {
    const root = await mkdtemp(join(tmpdir(), 'halt-record-not-a-repository-'));
    scratchRoots.push(root);

    await expect(resolveRecordability(root, 'needs-human')).resolves.toBe(false);
  });
});

async function makeScratchRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'halt-record-repository-'));
  scratchRoots.push(root);
  await execa('git', ['init', '-q', '-b', 'main'], { cwd: root });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: root });
  await writeFile(join(root, 'README.md'), 'test\n');
  await execa('git', ['add', 'README.md'], { cwd: root });
  await execa('git', ['commit', '-q', '-m', 'initial'], { cwd: root });
  return root;
}

async function makeFeatureRepository(): Promise<string> {
  const root = await makeScratchRepository();
  const worktree = join(root, '..', `${input.slug}-feature-worktree`);
  scratchRoots.push(worktree);
  await execa('git', ['worktree', 'add', '-q', '-b', input.branch, worktree], { cwd: root });
  return worktree;
}

async function commitCount(cwd: string): Promise<number> {
  const { stdout } = await execa('git', ['rev-list', '--count', 'HEAD'], { cwd });
  return Number.parseInt(stdout, 10);
}
