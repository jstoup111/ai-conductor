/**
 * Acceptance specs for ADR contradiction adjudication at the DECIDE land gate.
 *
 * Stories 4-7 cross the existing `runCoherenceGate` production facade. The
 * facade is the narrowest real internal boundary that composes required-layer
 * selection, artifact parsing, citation validation, coverage validation,
 * Git-backed change-status handling, deterministic reporting, and waivers.
 * Its only production caller is `landSpec`; that wiring already exists and is
 * covered by `decide-artifact-coherence-check.acceptance.test.ts`.
 *
 * Stories 1-3 are unit-covered by approved plan tasks 13-17: they specify the
 * config-read contract and the authored contents of two shipped skills, not a
 * multi-operation runtime flow. This file does not dispatch an LLM or call any
 * third party.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { AuthoringGuard } from '../../src/engine/engineer/authoring-guard.js';
import { resolveRequiredLayers, runCoherenceGate } from '../../src/engine/engineer/coherence-validator.js';

const execFile = promisify(execFileCb);

const STORIES = [
  '# Stories: ADR gate demo',
  '',
  '**Status:** Accepted',
  '',
  '## Story 1: honor the governing decision',
  '',
  '### Acceptance Criteria',
  '#### Happy Path',
  '- Given an approved decision, when the story is implemented, then the decision is honored.',
  '#### Negative Paths',
  '- Given a contradiction, when land validates it, then the spec is refused.',
  '',
].join('\n');

const PLAN = [
  '# Implementation Plan: ADR gate demo',
  '',
  '### Task 1: honor the decision',
  '**Story:** Story 1',
  '**Type:** happy-path',
  '',
  '## Coverage Check',
  '',
  '| Story | Tasks |',
  '| --- | --- |',
  '| 1 | 1 |',
  '',
].join('\n');

const BASE_ROWS = [
  '| Row Class | Id | Cited Ids | Verdict | Quote |',
  '| --- | --- | --- | --- | --- |',
  '| story | story-1 | task-1 | covered | "honor the governing decision" |',
  '| task | task-1 | story-1 | covered | "honor the decision" |',
];

const APPROVED_ADR = [
  '# ADR: emit one warning',
  '',
  '**Status:** Approved',
  '',
  'Emit one warning per discovery pass.',
  '',
].join('\n');

let fixtureRoot: string;
let canonicalPath: string;
let worktreePath: string;

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

async function writeRelative(root: string, path: string, content: string): Promise<void> {
  const absolute = join(root, path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

function coherence(...adrRows: string[]): string {
  return ['# Coherence: ADR gate demo', '', ...BASE_ROWS, ...adrRows, ''].join('\n');
}

interface SeedOptions {
  adrFiles?: Record<string, string>;
  coherenceText?: string;
  waiverText?: string;
  deleteBaseAdr?: boolean;
}

async function seedFeature(options: SeedOptions = {}): Promise<Set<string>> {
  const {
    adrFiles = {},
    coherenceText = coherence(),
    waiverText,
    deleteBaseAdr = false,
  } = options;

  await git(canonicalPath, ['worktree', 'add', '-q', '-b', 'spec/adr-gate-demo', worktreePath, 'main']);
  await writeRelative(worktreePath, '.docs/stories/adr-gate-demo.md', STORIES);
  await writeRelative(worktreePath, '.docs/plans/adr-gate-demo.md', PLAN);
  await writeRelative(worktreePath, '.docs/coherence/adr-gate-demo.md', coherenceText);

  for (const [path, content] of Object.entries(adrFiles)) {
    await writeRelative(worktreePath, path, content);
  }
  if (deleteBaseAdr) {
    await rm(join(worktreePath, '.docs/decisions/adr-retired.md'));
  }
  if (waiverText !== undefined) {
    await writeRelative(
      worktreePath,
      '.docs/coherence-waivers/adr-gate-demo.md',
      waiverText,
    );
  }

  await git(worktreePath, ['add', '-A']);
  await git(worktreePath, ['commit', '-q', '-m', 'seed feature']);

  const changed = await git(worktreePath, ['diff', '--name-only', 'main', 'HEAD']);
  return new Set(changed.split('\n').filter(Boolean));
}

async function runGate(ideaFiles: ReadonlySet<string>, tier: 'S' | 'M' = 'M'): Promise<void> {
  await runCoherenceGate({
    worktreePath,
    canonicalPath,
    tier,
    track: 'technical',
    sourceRef: undefined,
    planStem: 'adr-gate-demo',
    storiesText: STORIES,
    planText: PLAN,
    prdText: null,
    outcomeBullets: [],
    ideaFiles,
    guard: new AuthoringGuard(worktreePath),
  });
}

beforeEach(async () => {
  fixtureRoot = await mkdtemp(join(tmpdir(), 'adr-coherence-acceptance-'));
  canonicalPath = join(fixtureRoot, 'repo');
  worktreePath = join(fixtureRoot, 'worktree');

  await mkdir(canonicalPath);
  await git(canonicalPath, ['init', '-q', '-b', 'main']);
  await git(canonicalPath, ['config', 'user.email', 'test@example.com']);
  await git(canonicalPath, ['config', 'user.name', 'Test']);
  await writeRelative(canonicalPath, 'README.md', '# fixture\n');
  await writeRelative(
    canonicalPath,
    '.docs/decisions/adr-retired.md',
    '# ADR: retired\n\n**Status:** Approved\n',
  );
  await git(canonicalPath, ['add', '.']);
  await git(canonicalPath, ['commit', '-q', '-m', 'initial']);
});

afterEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe('Stories 4 and 6 — ADR rows are parsed, cross-checked, and enforced', () => {
  it('passes when every changed ADR has one covered row', async () => {
    const ideaFiles = await seedFeature({
      adrFiles: { '.docs/decisions/adr-warning-once.md': APPROVED_ADR },
      coherenceText: coherence(
        '| adr | adr-warning-once | story-1 | covered | "emit one warning per discovery pass" |',
      ),
    });

    await expect(runGate(ideaFiles)).resolves.toBeUndefined();
  });

  it('blocks once with every unadjudicated or negative-verdict ADR id', async () => {
    const ideaFiles = await seedFeature({
      adrFiles: {
        '.docs/decisions/adr-missing-row.md': APPROVED_ADR,
        '.docs/decisions/adr-failed-row.md': APPROVED_ADR,
      },
      coherenceText: coherence(
        '| adr | adr-failed-row | story-1 | fail | "story contradicts this decision" |',
      ),
    });

    await expect(runGate(ideaFiles)).rejects.toThrow(
      /adr-failed-row[\s\S]*adr-missing-row|adr-missing-row[\s\S]*adr-failed-row/,
    );
  });

  it('accepts an exact ADR waiver and rejects a waiver for a different id', async () => {
    let ideaFiles = await seedFeature({
      adrFiles: { '.docs/decisions/adr-warning-once.md': APPROVED_ADR },
      waiverText: 'Waives: adr-warning-once\nRationale: intentionally deferred for this spec.\n',
    });
    await expect(runGate(ideaFiles)).resolves.toBeUndefined();

    await rm(fixtureRoot, { recursive: true, force: true });
    await mkdir(fixtureRoot);
    canonicalPath = join(fixtureRoot, 'repo');
    worktreePath = join(fixtureRoot, 'worktree');
    await mkdir(canonicalPath);
    await git(canonicalPath, ['init', '-q', '-b', 'main']);
    await git(canonicalPath, ['config', 'user.email', 'test@example.com']);
    await git(canonicalPath, ['config', 'user.name', 'Test']);
    await writeRelative(canonicalPath, 'README.md', '# fixture\n');
    await git(canonicalPath, ['add', '.']);
    await git(canonicalPath, ['commit', '-q', '-m', 'initial']);

    ideaFiles = await seedFeature({
      adrFiles: { '.docs/decisions/adr-warning-once.md': APPROVED_ADR },
      waiverText: 'Waives: adr-somewhere-else\nRationale: this does not name the real gap.\n',
    });
    await expect(runGate(ideaFiles)).rejects.toThrow(/adr-warning-once/);
  });
});

describe('Stories 5 and 7 — committed signals preserve compatibility', () => {
  it('does not require ADR rows for decision review reports', async () => {
    const ideaFiles = await seedFeature({
      adrFiles: {
        '.docs/decisions/architecture-review-2026-08-09-demo.md': '# Review\n\nApproved.\n',
        '.docs/decisions/review-demo.md': '# Review\n\nClean.\n',
      },
    });

    const required = resolveRequiredLayers(worktreePath, 'M', 'technical', [], ideaFiles);
    expect(required.engaged).toBe(true);
    if (!required.engaged) return;
    expect(required.layers.has('adr')).toBe(false);
    await expect(runGate(ideaFiles)).resolves.toBeUndefined();
  });

  it('engages over an empty ADR pool when the only ADR change is a deletion', async () => {
    const ideaFiles = await seedFeature({ deleteBaseAdr: true });

    expect(ideaFiles.has('.docs/decisions/adr-retired.md')).toBe(true);
    const required = resolveRequiredLayers(worktreePath, 'M', 'technical', [], ideaFiles);
    expect(required.engaged && required.layers.has('adr')).toBe(true);
    await expect(runGate(ideaFiles)).resolves.toBeUndefined();
  });

  it('keeps tier-S and legacy change sets disengaged before ADR adjudication', async () => {
    const tierSIdeaFiles = await seedFeature({
      adrFiles: { '.docs/decisions/adr-warning-once.md': APPROVED_ADR },
      coherenceText: 'not a parseable coherence artifact',
    });
    expect(resolveRequiredLayers(worktreePath, 'S', 'technical', [], tierSIdeaFiles)).toEqual({
      engaged: false,
      reason: 'tier-exempt',
    });
    await expect(runGate(tierSIdeaFiles, 'S')).resolves.toBeUndefined();

    const legacyIdeaFiles = new Set(
      [...tierSIdeaFiles].filter((path) => !path.startsWith('.docs/coherence/')),
    );
    expect(resolveRequiredLayers(worktreePath, 'M', 'technical', [], legacyIdeaFiles)).toEqual({
      engaged: false,
      reason: 'legacy-change-set',
    });
    await expect(runGate(legacyIdeaFiles)).resolves.toBeUndefined();
  });
});
