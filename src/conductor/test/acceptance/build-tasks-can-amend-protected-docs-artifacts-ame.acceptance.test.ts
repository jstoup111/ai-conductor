/**
 * RED acceptance specs for #1293.
 *
 * Stories: `.docs/stories/build-tasks-can-amend-protected-docs-artifacts-ame.md`
 * ADR: `.docs/decisions/adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts.md`
 *
 * Story-level seams:
 * - TS-1 is an authoring contract, so the observable boundary is the three DECIDE
 *   skill surfaces that can falsify an accepted assertion. Their shared contract
 *   must require the mutation now, preserve the original assertion, and forbid a
 *   parallel record.
 * - TS-2's pure scan and inheritance matrix are lower-layer plan-task tests. This
 *   suite proves its public authoring surface exists and exercises the path guard
 *   through the land flow, including the mandatory trailing-root-empty-sibling
 *   boundary cases from writing-system-tests section 3c.
 * - TS-3 drives the real land-time entry point, `landSpec`, against real local Git.
 *   It observes refusal, diagnostics, no commit, and retained worktree state.
 * - TS-4's new behavior is a remediation-authority contract composing with the
 *   already-covered real daemon DECIDE operator gate. The latter remains covered by
 *   `daemon-decide-kickback-halt.acceptance.test.ts`; this file pins the new routing
 *   obligation without duplicating that broad Conductor fixture.
 *
 * Planned production call sites for the critical protected-target judgement:
 * - `src/conductor/src/index.ts` — authoring command dispatch (Task 6)
 * - `src/conductor/src/engine/engineer/land-spec.ts` — land gate (Task 7)
 * - `skills/plan/SKILL.md` — required authoring invocation (Task 11)
 *
 * No third party is called. Git is real because land/commit semantics are the
 * boundary under test; owner lookup and diagram rendering are injected fakes.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import { createProgram } from '../../src/index.js';
import { landSpec } from '../../src/engine/engineer/land-spec.js';
import { createEngineerWorktree } from '../../src/engine/engineer/worktree-authoring.js';
import type { GhRunner } from '../../src/engine/owner-gate/identity.js';

const execFile = promisify(execFileCb);
const CONDUCTOR_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REPO_ROOT = join(CONDUCTOR_ROOT, '..', '..');
const roots: string[] = [];

const okGh: GhRunner = async () => ({ stdout: 'acceptance-owner\n' });
const renderDeps = {
  hasTool: async () => true,
  writeTemp: async () => join(tmpdir(), 'unused-protected-target.mmd'),
  runMmdc: async () => ({ ok: true }),
};

afterEach(async () => {
  while (roots.length > 0) {
    await rm(roots.pop()!, { recursive: true, force: true });
  }
});

async function git(cwd: string, args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout.trim();
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function readContract(relativePath: string): Promise<string> {
  return readFile(join(REPO_ROOT, relativePath), 'utf8');
}

function hasStoryOnlyAmendmentException(contract: string): boolean {
  const exception = contract.match(
    /Story artifacts under `\.docs\/stories\/`[\s\S]{0,220}?exception[\s\S]{0,220}?\./i,
  )?.[0];

  return (
    exception !== undefined &&
    !/\b(?:plans?|specs?|ADRs?|architecture documents|coherence mappings)\b/i.test(exception)
  );
}

function widenStoryAmendmentException(contract: string): string {
  return contract.replace(
    'Story artifacts under `.docs/stories/`',
    'Story artifacts under `.docs/stories/`, plans, specs, and ADRs',
  );
}

interface LandFixture {
  repo: string;
  worktree: string;
  idea: string;
  slug: string;
  headBefore: string;
}

function renderPlan(slug: string, files: string, inherited = false): string {
  const inheritedTask = inherited
    ? [
        '',
        '### Task 2: inherit the protected target',
        '',
        '**Files:** same as Task 1',
        '',
        '**Wired-into:** same as Task 1',
      ].join('\n')
    : '';
  return [
    `# Implementation Plan: ${slug}`,
    '',
    `**Stories:** .docs/stories/${slug}.md`,
    '',
    '### Task 1: implement the change',
    '',
    `**Files:** ${files}`,
    '',
    // Must be a canonical waiver form: land's wiring-anchor gate runs the same
    // `extractWiredIntoContracts` parser BUILD does, and an invented `none (...)`
    // parenthetical is malformed there, not a fixture nicety.
    '**Wired-into:** none (no new production surface)',
    inheritedTask,
    '',
    '## Task Dependency Graph',
    '',
    '```text',
    inherited ? '1 → 2' : '1',
    '```',
    '',
  ].join('\n');
}

async function makeLandFixture(
  files: string,
  { inherited = false, tier = 'S' }: { inherited?: boolean; tier?: 'S' | 'M' } = {},
): Promise<LandFixture> {
  const repo = await mkdtemp(join(tmpdir(), 'protected-target-land-'));
  roots.push(repo);
  await git(repo, ['init', '-q', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'acceptance@example.com']);
  await git(repo, ['config', 'user.name', 'Acceptance']);
  await writeFile(join(repo, 'README.md'), '# fixture\n');
  await git(repo, ['add', 'README.md']);
  await git(repo, ['commit', '-q', '-m', 'fixture base']);

  const idea = `protected target ${Math.random().toString(36).slice(2)}`;
  const authored = await createEngineerWorktree(repo, idea);
  const { worktree, slug } = { worktree: authored.worktreePath, slug: authored.slug };

  // This acceptance flow is about the new land gate. Removing the coherence
  // signal deliberately selects landSpec's documented legacy disengage, so the
  // fixture does not author an unrelated traceability artifact.
  await rm(join(worktree, '.docs', 'coherence'), { recursive: true, force: true });
  for (const directory of ['track', 'complexity', 'stories', 'plans']) {
    await mkdir(join(worktree, '.docs', directory), { recursive: true });
  }
  await writeFile(join(worktree, '.docs', 'track', `${slug}.md`), 'Track: technical\n');
  await writeFile(join(worktree, '.docs', 'complexity', `${slug}.md`), `Tier: ${tier}\n`);
  await writeFile(
    join(worktree, '.docs', 'stories', `${slug}.md`),
    ['**Status:** Accepted', '', `# Stories: ${slug}`, '', '## Story', 'Given X, when Y, then Z.', ''].join('\n'),
  );
  await writeFile(join(worktree, '.docs', 'plans', `${slug}.md`), renderPlan(slug, files, inherited));

  if (tier === 'M') {
    for (const directory of ['conflicts', 'architecture', 'decisions']) {
      await mkdir(join(worktree, '.docs', directory), { recursive: true });
    }
    await writeFile(join(worktree, '.docs', 'conflicts', `${slug}.md`), '# Conflict check\n\nVerdict: PASS\n');
    await writeFile(join(worktree, '.docs', 'architecture', `${slug}.md`), '# Architecture\n');
    await writeFile(join(worktree, '.docs', 'decisions', `${slug}.md`), '# Architecture review\n\nVerdict: APPROVED\n');
  }

  return { repo, worktree, idea, slug, headBefore: await git(worktree, ['rev-parse', 'HEAD']) };
}

async function land(fixture: LandFixture) {
  return landSpec(
    { name: 'fixture', canonicalPath: fixture.repo },
    fixture.idea,
    fixture.worktree,
    undefined,
    { ownerConfig: {}, gh: okGh, renderDeps },
  );
}

describe('TS-1: accepted-artifact amendments are performed during DECIDE', () => {
  it.each([
    ['conflict-check', 'skills/conflict-check/SKILL.md'],
    ['architecture-review', 'skills/architecture-review/SKILL.md'],
  ])('%s requires the additive dated mutation now, never a later task or parallel record', async (_name, path) => {
    const text = await readContract(path);

    expect(text).toMatch(/Amended\s+YYYY-MM-DD\s+by\s+#NNN/i);
    expect(text).toMatch(/(?:write|perform|mutate|amend)[\s\S]{0,220}(?:during|in|same)\s+(?:the\s+)?(?:DECIDE|pass|review)/i);
    expect(text).toMatch(/original[\s\S]{0,160}(?:remain|preserv|never (?:rewrite|delete))/i);
    expect(text).toMatch(/no (?:separate|parallel) (?:record|ledger|artifact)/i);
    expect(text).toMatch(/never[\s\S]{0,180}(?:later phase|BUILD|plan task|defer)/i);
  });

  it('keeps conflict-check additive for non-story artifacts while replacing story assertions in place', async () => {
    const text = await readContract('skills/conflict-check/SKILL.md');
    const additiveNonStoryContract = /accepted\s+DECIDE\s+artifact[\s\S]{0,180}\.docs\/stories\/[\s\S]{0,100}narrow\s+exception[\s\S]{0,220}all\s+other\s+accepted\s+DECIDE\s+artifacts[\s\S]{0,220}Amended\s+YYYY-MM-DD\s+by\s+#NNN[\s\S]{0,260}non-story\s+artifacts[\s\S]{0,160}original\s+assertion\s+remains[\s\S]{0,120}do\s+not\s+rewrite\s+or\s+delete/i;

    expect(text).toMatch(additiveNonStoryContract);
    expect(text).toMatch(/stor(?:y|ies)[\s\S]{0,160}(?:replace|replacement)[\s\S]{0,100}in place[\s\S]{0,100}(?:no|without)[\s\S]{0,60}(?:amendment )?record/i);
    expect(hasStoryOnlyAmendmentException(text)).toBe(true);
    expect(hasStoryOnlyAmendmentException(widenStoryAmendmentException(text))).toBe(false);
  });

  it('keeps architecture-review additive for non-story artifacts while replacing story assertions in place', async () => {
    const text = await readContract('skills/architecture-review/SKILL.md');
    const additiveNonStoryContract = /accepted DECIDE assertion[\s\S]{0,180}amend that non-story artifact[\s\S]{0,220}Amended\s+YYYY-MM-DD\s+by\s+#NNN[\s\S]{0,280}every non-story artifact[\s\S]{0,160}original assertion remains preserved[\s\S]{0,140}\.docs\/stories\/[\s\S]{0,100}exception/i;

    expect(text).toMatch(additiveNonStoryContract);
    expect(text).toMatch(/stor(?:y|ies)[\s\S]{0,160}(?:replace|replacement)[\s\S]{0,100}in place[\s\S]{0,100}(?:no|without)[\s\S]{0,60}(?:amendment )?record/i);
    expect(hasStoryOnlyAmendmentException(text)).toBe(true);
    expect(hasStoryOnlyAmendmentException(widenStoryAmendmentException(text))).toBe(false);
  });

  it('requires stories to replace superseded assertions in place without an amendment record', async () => {
    const text = await readContract('skills/stories/SKILL.md');
    const storyCorrectionInstructions = text.match(
      /When a DECIDE correction[\s\S]*?(?=\n\*\*Stamp the canonical approval marker\.)/i,
    )?.[0];
    const preservesSupersededAssertion =
      /(?:original|superseded) assertion[\s\S]{0,80}(?:remain|preserv)|(?:remain|preserv)[\s\S]{0,80}(?:original|superseded) assertion|(?:original|superseded) assertion[\s\S]{0,80}never[\s\S]{0,80}(?:rewrite|delete)|never[\s\S]{0,80}(?:rewrite|delete)[\s\S]{0,80}(?:original|superseded) assertion/i;

    expect(text).toMatch(/replace[\s\S]{0,200}(?:in place|superseded)/i);
    expect(text).toMatch(/no[\s\S]{0,80}amendment record/i);
    expect(text).toMatch(/(?:pre-existing|legacy|existing)[\s\S]{0,180}amendment blocks?[\s\S]{0,240}(?:resolve|fold)[\s\S]{0,180}current behavioral text[\s\S]{0,180}(?:same DECIDE pass|same pass)/i);
    expect(text).toMatch(/(?:cannot|unable to)[\s\S]{0,180}determine[\s\S]{0,180}current behavior[\s\S]{0,240}correctness[\s\S]{0,100}assumption gate[\s\S]{0,160}(?:rather than|never)[\s\S]{0,100}delet/i);
    expect(text).not.toMatch(/Amended\s+YYYY-MM-DD\s+by\s+#NNN/i);
    expect(storyCorrectionInstructions).toBeDefined();
    expect(storyCorrectionInstructions).not.toMatch(preservesSupersededAssertion);

    // Selector robustness: each minimal additive mutation must be rejected, while
    // restricting the scan to the story-correction instruction avoids unrelated prose.
    for (const mutation of [
      'The original assertion remains preserved.',
      'The original assertion is preserved.',
      'The original assertion is never rewritten or deleted.',
    ]) {
      expect(`${storyCorrectionInstructions}\n${mutation}`).toMatch(preservesSupersededAssertion);
    }
  });

  it('keeps the additive amendment form while excepting story artifacts from amendment records', async () => {
    const text = await readContract('HARNESS.md');

    const additiveNonStoryContract = /accepted\s+DECIDE\s+artifact[\s\S]{0,180}\.docs\/stories\/[\s\S]{0,100}exception[\s\S]{0,220}all\s+other\s+accepted\s+DECIDE\s+artifacts[\s\S]{0,220}original\s+assertion[\s\S]{0,100}never\s+rewrite[\s\S]{0,80}delete[\s\S]{0,180}Amended\s+YYYY-MM-DD\s+by\s+#NNN/i;

    expect(text).toMatch(additiveNonStoryContract);
    expect(text).toMatch(/\.docs\/stories\/[\s\S]{0,200}replace[\s\S]{0,120}in place[\s\S]{0,120}no amendment record/i);
    expect(hasStoryOnlyAmendmentException(text)).toBe(true);
    expect(hasStoryOnlyAmendmentException(widenStoryAmendmentException(text))).toBe(false);
  });
});

describe('TS-2: the authoring boundary exposes a blocking protected-target check', () => {
  it('registers a public command whose name or description identifies both plan and protected targets', () => {
    const command = createProgram().commands.find((candidate) =>
      /plan/i.test(`${candidate.name()} ${candidate.description()}`) &&
      /protect/i.test(`${candidate.name()} ${candidate.description()}`),
    );

    expect(command).toBeDefined();
  });

  it('requires plan authoring to run the blocking conduct-ts command', async () => {
    const text = await readContract('skills/plan/SKILL.md');

    expect(text).toMatch(/conduct-ts\s+[^\n]*protect/i);
    expect(text).toMatch(/(?:block|fail|reject)[\s\S]{0,220}(?:task id|task)[\s\S]{0,160}(?:protected path|path)/i);
  });
});

describe('TS-3: landSpec refuses a plan that targets another feature\'s sealed artifact', () => {
  it.each(['S', 'M'] as const)('rejects at tier %s, names every offending task/path, commits nothing, and retains the worktree', async (tier) => {
    const fixture = await makeLandFixture('`.docs/stories/other-feature.md`', { inherited: true, tier });

    let caught: Error | null = null;
    try {
      await land(fixture);
    } catch (error) {
      caught = error instanceof Error ? error : new Error(String(error));
    }

    expect(caught).not.toBeNull();
    expect(caught!.message).toContain('Task 1');
    expect(caught!.message).toContain('Task 2');
    expect(caught!.message).toContain('.docs/stories/other-feature.md');
    expect(await git(fixture.worktree, ['rev-parse', 'HEAD'])).toBe(fixture.headBefore);
    expect(await exists(fixture.worktree)).toBe(true);
  });

  it('allows an own-feature sealed path and lands normally', async () => {
    const fixture = await makeLandFixture('OWN_FEATURE_PATH');
    const planPath = join(fixture.worktree, '.docs', 'plans', `${fixture.slug}.md`);
    const plan = (await readFile(planPath, 'utf8')).replace(
      'OWN_FEATURE_PATH',
      `\`.docs/stories/${fixture.slug}.md\``,
    );
    await writeFile(planPath, plan);

    await expect(land(fixture)).resolves.toMatchObject({ slug: fixture.slug });
  });

  it('allows a non-sealed .docs path and lands normally', async () => {
    const fixture = await makeLandFixture('`.docs/conflicts/other-feature.md`');

    await expect(land(fixture)).resolves.toMatchObject({ slug: fixture.slug });
  });

  describe('path-boundary matrix', () => {
    it.each([
      ['trailing slash', '`.docs/stories/other-feature.md/`'],
      ['sealed directory root', '`.docs/stories/`'],
    ])('rejects the %s form without treating it as a wildcard', async (_case, files) => {
      const fixture = await makeLandFixture(files);

      await expect(land(fixture)).rejects.toThrow(/protected|sealed/i);
    });

    it.each([
      ['empty file set', 'none (no files; contract-only task)'],
      ['sibling prefix', '`.docs/stories-evil/other-feature.md`'],
    ])('allows the non-matching %s boundary', async (_case, files) => {
      const fixture = await makeLandFixture(files);

      await expect(land(fixture)).resolves.toMatchObject({ slug: fixture.slug });
    });
  });
});

describe('TS-4: remediation never sends a sealed-artifact amendment to BUILD', () => {
  it('routes the gap to its owning DECIDE step and preserves the existing operator gate', async () => {
    const text = await readContract('skills/remediate/SKILL.md');

    expect(text).toMatch(/sealed|protected artifact/i);
    expect(text).toMatch(/(?:owning|owner)[\s\S]{0,160}DECIDE/i);
    expect(text).toMatch(/never[\s\S]{0,180}(?:build|acceptance_specs)[\s\S]{0,80}(?:build|acceptance_specs)/i);
    expect(text).toMatch(/existing[\s\S]{0,160}(?:operator|human)[ -]?gate/i);
    expect(text).toMatch(/no (?:request|ledger|record|new artifact)/i);
  });
});
