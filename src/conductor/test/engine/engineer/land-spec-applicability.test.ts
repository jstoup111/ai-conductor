// Covers: task:4
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { LandGateError, landSpec } from '../../../src/engine/engineer/land-spec.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';
import { validateApplicability } from '../../../src/engine/feature-applicability.js';

const execFile = promisify(execFileCb);
const IDEA = 'applicability landing';
let repoPath: string;

async function git(args: string[], cwd = repoPath): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

const renderDeps = {
  hasTool: async () => true,
  writeTemp: async () => '/tmp/land-spec-applicability.mmd',
  runMmdc: async () => ({ ok: true }),
};

async function seed(enabled: boolean, marker?: string, markerStem?: string): Promise<string> {
  await mkdir(join(repoPath, '.ai-conductor'), { recursive: true });
  await writeFile(
    join(repoPath, '.ai-conductor', 'config.yml'),
    enabled ? 'feature_applicability:\n  enabled: true\n' : '{}\n',
  );
  const { worktreePath } = await createEngineerWorktree(repoPath, IDEA);
  // The fixture exercises applicability landing, not the independent
  // coherence gate. Keep the existing local-Git fixture pattern that makes
  // this a legacy, disengaged coherence scenario.
  await rm(join(worktreePath, '.docs', 'coherence'), { recursive: true, force: true });
  const stem = 'applicability-landing';
  await Promise.all([
    mkdir(join(worktreePath, '.docs', 'specs'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'stories'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'plans'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'complexity'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'conflicts'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'architecture'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'decisions'), { recursive: true }),
  ]);
  await writeFile(join(worktreePath, '.docs', 'specs', `${stem}.md`), '# PRD\n\nApproved.\n');
  await writeFile(join(worktreePath, '.docs', 'stories', `${stem}.md`), [
    '# Stories', '', '**Status:** Accepted', '', '## Story 1: land', '### Acceptance Criteria',
    '#### Happy Path', '- Given a marker, when land runs, then it commits.', '',
    '#### Negative Paths', '- Given an invalid marker, when land runs, then it refuses.', '',
  ].join('\n'));
  await writeFile(join(worktreePath, '.docs', 'plans', `${stem}.md`), [
    '# Implementation Plan', '', `**Stories:** .docs/stories/${stem}.md`, '',
    '### Task 1: Land', '**Story:** Story 1', '', '**Done when:**',
    '- Given a marker, when land runs, then it commits.',
    '- Given an invalid marker, when land runs, then it refuses.', '',
    '## Coverage Check', '', '| Criterion | Task ids | Quote | Disposition |',
    '| --- | --- | --- | --- |',
    '| Story 1 happy: Given a marker, when land runs, then it commits. | 1 | "Given a marker, when land runs, then it commits." | diff-local |',
    '| Story 1 negative: Given an invalid marker, when land runs, then it refuses. | 1 | "Given an invalid marker, when land runs, then it refuses." | diff-local |', '',
  ].join('\n'));
  await writeFile(join(worktreePath, '.docs', 'complexity', `${stem}.md`), 'Tier: M\n');
  await writeFile(join(worktreePath, '.docs', 'conflicts', `${stem}.md`), '# Conflicts\n\nNone.\n');
  await writeFile(join(worktreePath, '.docs', 'architecture', `${stem}.md`), '# Architecture\n\n```mermaid\nflowchart TD\n  A --> B\n```\n');
  await writeFile(join(worktreePath, '.docs', 'decisions', `${stem}.md`), '# Architecture review\n\nApproved.\n');
  if (marker !== undefined) {
    await mkdir(join(worktreePath, '.docs', 'applicability'), { recursive: true });
    await writeFile(join(worktreePath, '.docs', 'applicability', `${markerStem ?? stem}.md`), marker);
  }
  return worktreePath;
}

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'land-spec-applicability-'));
  await git(['init', '-b', 'main', '-q']);
  await git(['config', 'user.email', 'test@example.test']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repoPath, 'README.md'), '# repo\n');
  await git(['add', 'README.md']);
  await git(['commit', '-m', 'init']);
});

afterEach(async () => {
  await rm(repoPath, { recursive: true, force: true });
});

function options() {
  return { ownerConfig: { spec_owner: 'test-owner' }, renderDeps };
}

async function refusal(enabled: boolean, marker: string, markerStem?: string): Promise<LandGateError> {
  const worktreePath = await seed(enabled, marker, markerStem);
  const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options())
    .catch((reason: unknown) => reason);

  expect(error).toBeInstanceOf(LandGateError);
  expect(await git(['log', '--format=%s'])).toBe('init');
  return error as LandGateError;
}

describe('landSpec applicability marker', () => {
  it('validates an enabled declarable marker into its parsed declaration', () => {
    expect(validateApplicability('Inapplicable: manual_test — no browser-facing behavior\n', {
      enabled: true,
      customStepNames: [],
    })).toEqual({
      ok: true,
      declarations: [{ step: 'manual_test', reason: 'no browser-facing behavior', line: 1 }],
    });
  });

  it.each([
    ['a disabled capability', 'Inapplicable: manual_test — no browser-facing behavior\n', false, {
      kind: 'capability-disabled', line: 1,
    }],
    ['an unknown step', 'Inapplicable: no_such_step — no browser-facing behavior\n', true, {
      kind: 'unknown-step', line: 1, step: 'no_such_step',
    }],
    ['a known but non-declarable step', 'Inapplicable: prd_audit — no browser-facing behavior\n', true, {
      kind: 'not-declarable', line: 1, step: 'prd_audit',
    }],
    ['an empty reason', 'Inapplicable: manual_test —   \n', true, {
      kind: 'empty-reason', line: 1,
    }],
    ['a malformed declaration', 'Inapplicable: manual_test\n', true, {
      kind: 'malformed-line', line: 1,
    }],
    ['a duplicate declaration', [
      'Inapplicable: manual_test — no browser-facing behavior',
      'Inapplicable: manual_test — still no browser-facing behavior',
      '',
    ].join('\n'), true, {
      kind: 'duplicate-declaration', line: 2, step: 'manual_test',
    }],
  ])('reports the first typed failure for %s', (_case, marker, enabled, error) => {
    expect(validateApplicability(marker, { enabled, customStepNames: [] })).toEqual({ ok: false, error });
  });

  it('lands an enabled valid marker in the same DECIDE commit', async () => {
    const worktreePath = await seed(true, 'Inapplicable: manual_test — no browser-facing behavior\n');

    await expect(landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options()))
      .resolves.toMatchObject({ branch: 'spec/applicability-landing' });

    expect((await git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], worktreePath)).split('\n')).toEqual(
      expect.arrayContaining([
        '.docs/applicability/applicability-landing.md',
        '.docs/plans/applicability-landing.md',
        '.docs/stories/applicability-landing.md',
        '.docs/specs/applicability-landing.md',
      ]),
    );
  });

  it('keeps markerless land identical whether the capability is enabled or disabled', async () => {
    const enabledWorktree = await seed(true);
    await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, enabledWorktree, undefined, options());
    const enabledFiles = await git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], enabledWorktree);

    await rm(repoPath, { recursive: true, force: true });
    repoPath = await mkdtemp(join(tmpdir(), 'land-spec-applicability-disabled-'));
    await git(['init', '-b', 'main', '-q']);
    await git(['config', 'user.email', 'test@example.test']);
    await git(['config', 'user.name', 'Test']);
    await writeFile(join(repoPath, 'README.md'), '# repo\n');
    await git(['add', 'README.md']);
    await git(['commit', '-m', 'init']);
    const disabledWorktree = await seed(false);
    await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, disabledWorktree, undefined, options());

    expect(await git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], disabledWorktree)).toBe(enabledFiles);
  });

  it.each([
    ['unknown-step', 'Inapplicable: nonexistent_step — no matching step\n', ['nonexistent_step', 'line 1']],
    ['not-declarable', 'Inapplicable: test_suite — suite must run\n', ['test_suite', 'line 1']],
    ['empty-reason', 'Inapplicable: manual_test —   \n', ['line 1']],
    ['duplicate-declaration', [
      'Inapplicable: manual_test — no browser-facing behavior',
      'Inapplicable: manual_test — still no browser-facing behavior',
      '',
    ].join('\n'), ['manual_test', 'line 2']],
  ])('refuses an enabled marker with %s without creating a land commit', async (kind, marker, details) => {
    const error = await refusal(true, marker);

    expect(error).toMatchObject({ gate: 'applicability-invalid' });
    expect(error.message).toContain(kind);
    for (const detail of details) expect(error.message).toContain(detail);
  });

  it('refuses any marker while the capability is disabled without creating a land commit', async () => {
    const error = await refusal(false, 'Inapplicable: manual_test — no browser-facing behavior\n');

    expect(error).toMatchObject({ gate: 'applicability-invalid' });
    expect(error.message).toContain('capability-disabled');
    expect(error.message).toContain('.docs/applicability/applicability-landing.md');
    expect(error.message).toContain('line 1');
  });

  it('refuses an applicability marker with a mismatched stem without creating a land commit', async () => {
    const error = await refusal(
      true,
      'Inapplicable: manual_test — no browser-facing behavior\n',
      'different-feature',
    );

    expect(error).toMatchObject({ gate: 'artifact-stem-mismatch' });
    expect(error.message).toContain('.docs/applicability/different-feature.md');
  });

  it('refuses a mismatched sibling marker that would otherwise be staged with the valid marker', async () => {
    const worktreePath = await seed(true, 'Inapplicable: manual_test — no browser-facing behavior\n');
    await writeFile(
      join(worktreePath, '.docs', 'applicability', 'different-feature.md'),
      'Inapplicable: manual_test — sibling marker\n',
    );

    const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options())
      .catch((reason: unknown) => reason);

    expect(error).toMatchObject({ gate: 'artifact-stem-mismatch' });
    expect((error as Error).message).toContain('.docs/applicability/different-feature.md');
    expect(await git(['log', '--format=%s'])).toBe('init');
  });
});
