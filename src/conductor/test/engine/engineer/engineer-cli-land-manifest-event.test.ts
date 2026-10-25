// Covers: task:6

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { dispatchEngineer, type DispatchEngineerOpts } from '../../../src/engine/engineer-cli.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';
import { resolveIdeaFiles } from '../../../src/engine/engineer/land-spec.js';
import { computeReviewedDigest, renderPlanReviewArtifact } from '../../../src/engine/plan-review-artifact.js';
import type { GhRunner } from '../../../src/engine/tracker-client.js';
import type { ConductorEvent } from '../../../src/types/events.js';

const execFile = promisify(execFileCb);
const IDEA = 'manifest event';
const SLUG = 'manifest-event';
const STORIES = `# Stories: manifest event

**Status:** Accepted

## Story 1: register manifest entries

### Acceptance Criteria

#### Happy Path

- Given authored artifacts, when land runs, then it writes their manifest.

#### Negative Paths

- Given no changes, when land runs again, then it does not add entries.
`;
const PLAN = `# Implementation Plan: manifest event

**Stories:** .docs/stories/${SLUG}.md

## Task Dependency Graph

\`\`\`
1
\`\`\`

### Task 1: register entries

**Files likely touched:**

- src/example.ts

**Done when:**

- [test] Land records the manifest entries.
- [test] Unchanged land records no new entries.
`;

type FeatureArtifactsRegistered = Extract<ConductorEvent, { type: 'feature_artifacts_registered' }>;

let root: string;
let repo: string;
let registry: string;

async function git(args: string[], cwd = repo): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout.trim();
}

async function seedWorktree(): Promise<string> {
  const { worktreePath } = await createEngineerWorktree(repo, IDEA);
  await rm(join(worktreePath, '.docs', 'coherence'), { recursive: true, force: true });
  await Promise.all(['specs', 'stories', 'plans'].map((directory) =>
    mkdir(join(worktreePath, '.docs', directory), { recursive: true }),
  ));
  await Promise.all([
    writeFile(join(worktreePath, `.docs/specs/${SLUG}.md`), '# PRD: manifest event\n\nApproved.\n'),
    writeFile(join(worktreePath, `.docs/stories/${SLUG}.md`), STORIES),
    writeFile(join(worktreePath, `.docs/plans/${SLUG}.md`), PLAN),
  ]);

  const planText = await readFile(join(worktreePath, `.docs/plans/${SLUG}.md`), 'utf8');
  const reviewedDigest = computeReviewedDigest({
    planText,
    storiesText: STORIES,
    adrTexts: {},
    artifactTexts: { [`.docs/coherence/${SLUG}.md`]: '' },
    changedPaths: [...await resolveIdeaFiles(worktreePath, repo)],
  });
  await mkdir(join(worktreePath, '.docs', 'plan-review'), { recursive: true });
  await writeFile(
    join(worktreePath, `.docs/plan-review/${SLUG}.md`),
    renderPlanReviewArtifact({
      round: 1,
      authoringHost: 'claude',
      reviewerProvider: 'codex',
      independence: 'cross-provider',
      findings: [],
      dispositions: [],
      reviewedDigest,
    }),
  );
  return worktreePath;
}

const gh: GhRunner = async (args) => {
  if (args.join(' ') === 'api user --jq .login') return { stdout: 'operator\n' };
  throw new Error(`unexpected gh call: ${args.join(' ')}`);
};

async function land(worktree: string): Promise<number> {
  const errors: string[] = [];
  const options: DispatchEngineerOpts = {
    registryPath: registry,
    gh,
    print: () => undefined,
    printErr: (line) => errors.push(line),
  };
  const code = await dispatchEngineer({ kind: 'land', project: 'target', idea: IDEA, worktree }, options);
  if (code !== 0) throw new Error(errors.join('\n'));
  return code;
}

async function registeredEvents(): Promise<FeatureArtifactsRegistered[]> {
  try {
    const lines = (await readFile(join(repo, '.pipeline', 'composer-events.jsonl'), 'utf8')).trim().split('\n');
    return lines.filter(Boolean).map((line) => JSON.parse(line) as ConductorEvent)
      .filter((event): event is FeatureArtifactsRegistered => event.type === 'feature_artifacts_registered');
  } catch {
    return [];
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'cli-land-manifest-event-'));
  repo = join(root, 'repo');
  registry = join(root, 'registry.json');
  await mkdir(repo, { recursive: true });
  await git(['init', '-b', 'main', '-q']);
  await git(['config', 'user.email', 'test@example.test']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repo, 'README.md'), '# repo\n');
  await git(['add', 'README.md']);
  await git(['commit', '-m', 'init']);
  await writeFile(registry, JSON.stringify([{
    schemaVersion: 1,
    name: 'target',
    path: repo,
    status: 'registered',
    registeredAt: '2026-01-01T00:00:00.000Z',
  }]));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 3 });
});

describe('compose land manifest registration event', () => {
  it('appends exactly one event naming the slug and every added artifact entry', async () => {
    const worktree = await seedWorktree();

    expect(await land(worktree)).toBe(0);

    const events = await registeredEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'feature_artifacts_registered',
      slug: SLUG,
      added: expect.arrayContaining([
        { kind: 'prd', path: `.docs/specs/${SLUG}.md` },
        { kind: 'stories', path: `.docs/stories/${SLUG}.md` },
        { kind: 'plan', path: `.docs/plans/${SLUG}.md` },
        { kind: 'intake', path: `.docs/intake/${SLUG}.md` },
      ]),
    });
    expect(events[0].added).toHaveLength(4);
  });

  it('does not append a registration event when unchanged land adds no entries', async () => {
    const worktree = await seedWorktree();
    expect(await land(worktree)).toBe(0);

    expect(await land(worktree)).toBe(0);

    expect(await registeredEvents()).toHaveLength(1);
  });
});
