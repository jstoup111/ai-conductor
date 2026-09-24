// Covers: task:3
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { resolveCoverageBindingDecideSet } from '../../src/engine/coverage-binding-decide-set.js';

const execFile = promisify(execFileCallback);
let projectRoot: string;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFile(
    'git',
    ['-c', 'user.email=fixture@example.test', '-c', 'user.name=fixture', ...args],
    { cwd: projectRoot },
  );
  return stdout.trim();
}

async function write(relativePath: string, contents: string): Promise<void> {
  const absolutePath = join(projectRoot, relativePath);
  await mkdir(join(absolutePath, '..'), { recursive: true });
  await writeFile(absolutePath, contents);
}

async function commit(message: string): Promise<void> {
  await git('add', '.');
  await git('commit', '-q', '-m', message);
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), 'coverage-binding-decide-set-'));
  await git('init', '-q', '-b', 'main');
  await write('.docs/decisions/adr-base-only.md', '# Base ADR\n');
  await write('.docs/decisions/adr-cited.md', '# Cited ADR\n');
  await commit('base DECIDE artifacts');

  await git('checkout', '-q', '-b', 'feature');
  await write('.docs/plans/feature.md', `# Plan\n\n**Stories:** .docs/stories/feature.md\n\n## Architecture Obligation Coverage\n\n| Decision | Disposition | Task(s) | Evidence |\n| --- | --- | --- | --- |\n| adr-cited#D1 | existing | none | Retained behavior. |\n`);
  await write('.docs/stories/feature.md', '# Stories\n');
  await write('.docs/specs/feature.md', '# PRD\n');
  await write('.docs/decisions/architecture-review-2026-09-24-feature.md', '# Review\n');
  await write('.docs/decisions/adr-branch-changed.md', '# Changed on feature\n');
  await commit('feature DECIDE artifacts');

  await git('checkout', '-q', 'main');
  await write('.docs/decisions/adr-base-only.md', '# Base-only follow-up\n');
  await commit('base-only ADR change');
  await git('checkout', '-q', 'feature');
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe('resolveCoverageBindingDecideSet', () => {
  it('collects feature DECIDE artifacts and excludes an ADR changed only on the base', async () => {
    const decideSet = await resolveCoverageBindingDecideSet(projectRoot, 'feature');
    if (!decideSet) throw new Error('expected feature plan to resolve');

    expect(decideSet).toMatchObject({
      planPath: '.docs/plans/feature.md',
      storiesPath: '.docs/stories/feature.md',
      architectureReviewPath: '.docs/decisions/architecture-review-2026-09-24-feature.md',
      prdPath: '.docs/specs/feature.md',
    });
    expect([...decideSet.paths].sort()).toEqual([
      '.docs/decisions/adr-branch-changed.md',
      '.docs/decisions/adr-cited.md',
      '.docs/decisions/architecture-review-2026-09-24-feature.md',
      '.docs/plans/feature.md',
      '.docs/specs/feature.md',
      '.docs/stories/feature.md',
    ]);
  });

  it('omits a missing PRD and architecture review without failing', async () => {
    await git('rm', '-q', '.docs/specs/feature.md', '.docs/decisions/architecture-review-2026-09-24-feature.md');
    await git('commit', '-q', '-m', 'remove optional artifacts');

    const decideSet = await resolveCoverageBindingDecideSet(projectRoot, 'feature');
    if (!decideSet) throw new Error('expected feature plan to resolve');

    expect(decideSet.prdPath).toBeUndefined();
    expect(decideSet.architectureReviewPath).toBeUndefined();
  });
});
