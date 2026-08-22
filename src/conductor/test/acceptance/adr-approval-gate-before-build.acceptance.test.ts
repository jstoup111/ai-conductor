// Acceptance specs for adr-approval-gate-before-build (#662).
//
// These specs drive every production call site of the approval derivation:
// - src/engine/engineer/authoring.ts:472 — runAuthoring
// - src/engine/engineer/land-spec.ts:316 — landSpec
// - src/engine/daemon-backlog.ts:703 — discoverBacklog (new pre-dispatch rung)
//
// Parser grammar, git-tree enumeration, the unchanged as-built backstop, and
// template vocabulary are single-operation contracts owned by the plan's unit
// tests. This file owns the observable cross-operation flows: authoring/landing
// refusal without mutation, and discovery block -> correction -> dispatch.

import { execFile as execFileCb } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BacklogTreeSource } from '../../src/engine/backlog-tree-source.js';
import { discoverBacklog } from '../../src/engine/daemon-backlog.js';
import { runAuthoring, type DecideStep } from '../../src/engine/engineer/authoring.js';
import { landSpec } from '../../src/engine/engineer/land-spec.js';
import { createEngineerWorktree } from '../../src/engine/engineer/worktree-authoring.js';
import type { GhRunner } from '../../src/engine/owner-gate/identity.js';

const execFile = promisify(execFileCb);
const resolvingGh: GhRunner = async () => ({ stdout: 'operator\n' });

const STORIES = [
  '# Stories: ADR approval demo',
  '',
  '**Status:** Accepted',
  '',
  '## Story 1: enforce approval',
  '',
  '### Acceptance Criteria',
  '- Given an ADR corpus, when the gate runs, then only approved decisions pass.',
  '',
].join('\n');

const PLAN = [
  '# Implementation Plan: ADR approval demo',
  '',
  '**Stories:** .docs/stories/adr-approval-demo.md',
  '',
  '### Task 1: enforce approval',
  '**Story:** 1',
  '**Dependencies:** none',
  '**Done when:**',
  '- Approved ADR declarations are accepted.',
  '- Non-approved ADR declarations are rejected.',
  '',
].join('\n');

const COHERENCE = [
  '| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |',
  '|---|---|---|---|---|',
  '| story | S1 | Task 1 | covered | fixture |',
  '',
].join('\n');

let repoPath: string;

async function git(args: string[], cwd = repoPath): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'adr-approval-acceptance-'));
  await git(['init', '-b', 'main', '-q']);
  await git(['config', 'user.email', 'test@test.com']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repoPath, 'README.md'), '# fixture\n');
  await writeFile(join(repoPath, '.gitignore'), '.pipeline/\n');
  await git(['add', 'README.md', '.gitignore']);
  await git(['commit', '-m', 'init']);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(repoPath, { recursive: true, force: true });
});

function target() {
  return { name: 'fixture', canonicalPath: repoPath };
}

async function seedLandWorktree(adrs: Record<string, string>): Promise<string> {
  const { worktreePath } = await createEngineerWorktree(repoPath, 'ADR approval demo');
  const docs = join(worktreePath, '.docs');
  await Promise.all([
    mkdir(join(docs, 'stories'), { recursive: true }),
    mkdir(join(docs, 'plans'), { recursive: true }),
    mkdir(join(docs, 'track'), { recursive: true }),
    mkdir(join(docs, 'complexity'), { recursive: true }),
    mkdir(join(docs, 'decisions'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(docs, 'stories', 'adr-approval-demo.md'), STORIES),
    writeFile(join(docs, 'plans', 'adr-approval-demo.md'), PLAN),
    writeFile(join(docs, 'track', 'adr-approval-demo.md'), '# Track\n\nTrack: technical\n'),
    writeFile(join(docs, 'complexity', 'adr-approval-demo.md'), '# Complexity\n\nTier: S\n'),
    ...Object.entries(adrs).map(([name, content]) =>
      writeFile(join(docs, 'decisions', name), content),
    ),
  ]);
  return worktreePath;
}

function authoringDecide(reviewArtifact: string) {
  return async (step: DecideStep) => {
    const artifacts: Record<DecideStep, string> = {
      explore: '# Explore\n\nTechnical track.\n',
      prd: '# PRD\n\nNot used on the technical track.\n',
      architecture_diagram: '# Architecture\n\nNo diagram required.\n',
      architecture_review: reviewArtifact,
      stories: STORIES,
      conflict_check: '# Conflict Check\n\nClean.\n',
      plan: PLAN,
      coherence_check: COHERENCE,
    };
    return { approved: true, artifact: artifacts[step] };
  };
}

describe('authoring and land use the same declaration-aware approval signal', () => {
  it('runAuthoring refuses Proposed before creating a branch or writing artifacts', async () => {
    await expect(
      runAuthoring(target(), 'ADR approval demo', {
        decide: authoringDecide('# ADR\n\nStatus: Proposed\n'),
        assessComplexity: async () => ({ approved: true, tier: 'M' }),
        track: 'technical',
      }),
    ).rejects.toThrow(/Proposed|not approved/i);

    expect(await git(['branch', '--list', 'spec/*'])).toBe('');
  });

  it('runAuthoring accepts APPROVED when a later sentence merely illustrates Status: DRAFT', async () => {
    const review = [
      '# ADR',
      '',
      'Status: APPROVED',
      '',
      'The rejected example requires Status: DRAFT, but that prose is not a declaration.',
      '',
    ].join('\n');

    await expect(
      runAuthoring(target(), 'ADR approval demo', {
        decide: authoringDecide(review),
        assessComplexity: async () => ({ approved: true, tier: 'M' }),
        track: 'technical',
      }),
    ).resolves.toMatchObject({ branch: 'spec/adr-approval-demo' });
  });

  it('landSpec accepts APPROVED when a later sentence merely illustrates Status: DRAFT', async () => {
    const worktree = await seedLandWorktree({
      'adr-demo.md': [
        '# ADR',
        '',
        'Status: APPROVED',
        '',
        'The rejected example requires Status: DRAFT, but that prose is not a declaration.',
        '',
      ].join('\n'),
    });

    await expect(
      landSpec(target(), 'ADR approval demo', worktree, undefined, {
        ownerConfig: {},
        gh: resolvingGh,
      }),
    ).resolves.toMatchObject({ branch: 'spec/adr-approval-demo' });
  });
});

describe('landSpec rejects the complete non-conforming corpus without destroying operator state', () => {
  it('names a Proposed ADR and preserves both the worktree and primary tree', async () => {
    const worktree = await seedLandWorktree({ 'adr-proposed.md': '# ADR\n\nStatus: Proposed\n' });
    const primaryHead = await git(['rev-parse', 'HEAD']);

    let failure: Error | undefined;
    try {
      await landSpec(target(), 'ADR approval demo', worktree, undefined, {
        ownerConfig: {},
        gh: resolvingGh,
      });
    } catch (error) {
      failure = error as Error;
    }

    expect(failure?.message).toMatch(/adr-proposed\.md.*Proposed/i);
    await expect(access(worktree)).resolves.toBeUndefined();
    expect(await git(['rev-parse', 'HEAD'])).toBe(primaryHead);
  });

  it('distinguishes an ADR with no declaration from a disallowed value', async () => {
    const worktree = await seedLandWorktree({ 'adr-missing.md': '# ADR\n\nNo declaration here.\n' });

    await expect(
      landSpec(target(), 'ADR approval demo', worktree, undefined, {
        ownerConfig: {},
        gh: resolvingGh,
      }),
    ).rejects.toThrow(/adr-missing\.md.*no status declaration/i);
  });

  it('reports every offending ADR in one rejection', async () => {
    const worktree = await seedLandWorktree({
      'adr-first.md': '# ADR\n\nStatus: Proposed\n',
      'adr-second.md': '# ADR\n\nStatus: Accepted\n',
    });

    await expect(
      landSpec(target(), 'ADR approval demo', worktree, undefined, {
        ownerConfig: {},
        gh: resolvingGh,
      }),
    ).rejects.toThrow(/adr-first\.md[\s\S]*adr-second\.md|adr-second\.md[\s\S]*adr-first\.md/i);
  });
});

type AdrAwareTreeSource = BacklogTreeSource & {
  listAdrFiles(): Promise<string[]>;
};

function backlogFixture(status: 'APPROVED' | 'Proposed') {
  const slugs = ['alpha', 'beta', 'gamma'];
  const files = new Map<string, string>();
  for (const slug of slugs) {
    files.set(
      `.docs/plans/${slug}.md`,
      `# Plan\n**Stories:** .docs/stories/${slug}.md\n### Task 1\n**Dependencies:** none\n`,
    );
    files.set(`.docs/stories/${slug}.md`, '# Stories\n\n**Status:** Accepted\n');
    files.set(`.docs/complexity/${slug}.md`, '# Complexity\n\nTier: S\n');
  }
  files.set('.docs/decisions/adr-gate.md', `# ADR\n\nStatus: ${status}\n`);

  const listAdrFiles = vi.fn(async () => ['adr-gate.md']);
  const readFile = vi.fn(async (path: string) => files.get(path) ?? null);
  const tree: AdrAwareTreeSource = {
    listPlanFiles: async () => slugs.map((slug) => `${slug}.md`),
    listShippedFiles: async () => [],
    listAdrFiles,
    readFile,
  };
  return { files, listAdrFiles, readFile, slugs, tree };
}

function discoveryOptions(tree: AdrAwareTreeSource) {
  const warned = new Set<string>();
  return {
    treeSource: tree,
    isOperatorParked: async () => false,
    writeBlockedSnapshot: vi.fn(async () => {}),
    hasWarned: async (key: string) => warned.has(key),
    markWarned: async (key: string) => {
      warned.add(key);
    },
  };
}

describe('daemon discovery gates the ADR corpus once per pass and recovers on correction', () => {
  it('dispatches every eligible spec when the ADR corpus is conforming', async () => {
    const fixture = backlogFixture('APPROVED');

    const result = await discoverBacklog(repoPath, undefined, undefined, discoveryOptions(fixture.tree));

    expect(result.items.map(({ slug }) => slug)).toEqual(fixture.slugs);
    expect(result.blocked).toEqual([]);
  });

  it('blocks every candidate, records an actionable row per slug, and scans only once', async () => {
    const fixture = backlogFixture('Proposed');
    const logs: string[] = [];

    const result = await discoverBacklog(
      repoPath,
      undefined,
      (message) => logs.push(message),
      discoveryOptions(fixture.tree),
    );

    expect(result.items).toEqual([]);
    expect(result.blocked).toHaveLength(3);
    expect(result.blocked).toEqual(
      fixture.slugs.map((slug) =>
        expect.objectContaining({
          slug,
          reason: 'adr-not-approved',
          remedy: expect.stringMatching(/adr-gate\.md.*Proposed/i),
        }),
      ),
    );
    expect(fixture.listAdrFiles).toHaveBeenCalledTimes(1);
    expect(
      fixture.readFile.mock.calls.filter(([path]) => path === '.docs/decisions/adr-gate.md'),
    ).toHaveLength(1);
    expect(logs.filter((message) => /adr.*not approved|unapproved adr/i.test(message))).toHaveLength(1);
  });

  it('does not repeat the corpus warning on the next poll while blocked rows stay current', async () => {
    const fixture = backlogFixture('Proposed');
    const logs: string[] = [];
    const options = discoveryOptions(fixture.tree);

    const first = await discoverBacklog(repoPath, undefined, (message) => logs.push(message), options);
    const second = await discoverBacklog(repoPath, undefined, (message) => logs.push(message), options);

    expect(second.blocked).toEqual(first.blocked);
    expect(fixture.listAdrFiles).toHaveBeenCalledTimes(2);
    expect(logs.filter((message) => /adr.*not approved|unapproved adr/i.test(message))).toHaveLength(1);
  });

  it('clears blocked rows and resumes dispatch on the first poll after correction', async () => {
    const fixture = backlogFixture('Proposed');
    const options = discoveryOptions(fixture.tree);

    const blocked = await discoverBacklog(repoPath, undefined, undefined, options);
    fixture.files.set('.docs/decisions/adr-gate.md', '# ADR\n\nStatus: APPROVED\n');
    const recovered = await discoverBacklog(repoPath, undefined, undefined, options);

    expect(blocked.items).toEqual([]);
    expect(blocked.blocked).toHaveLength(3);
    expect(recovered.blocked).toEqual([]);
    expect(recovered.items.map(({ slug }) => slug)).toEqual(fixture.slugs);
  });
});
