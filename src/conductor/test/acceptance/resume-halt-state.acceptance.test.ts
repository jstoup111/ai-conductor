/**
 * Acceptance coverage for #1415: a daemon re-dispatch turns the branch's
 * existing halt PR back into an in-flight implementation PR before BUILD
 * consumes it, and the reconciliation sweep agrees with that state.
 *
 * Real production call sites exercised:
 * - src/engine/conductor.ts: Conductor.run dispatch boundary
 * - src/engine/halt-pr-reconciliation.ts: reconcileHaltPrs sweep
 *
 * GitHub and Git are the only external boundaries and are replaced by a
 * stateful fake. The test intentionally enters through Conductor.run rather
 * than calling a future clear helper directly, so it fails while the helper is
 * unwired even if that helper's unit tests pass.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { reconcileHaltPrs } from '../../src/engine/halt-pr-reconciliation.js';
import {
  NEEDS_REMEDIATION_BODY_MARKER,
  NEEDS_REMEDIATION_MARKER,
} from '../../src/engine/pr-labels.js';
import type { GhRunner, GitRunner } from '../../src/engine/pr-labels.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const BRANCH = 'feat/daemon-stuck-widget';
const PR_URL = 'https://github.com/acme/widgets/pull/1412';
const COMMENT_URL = `${PR_URL}#issuecomment-99`;

interface FakePr {
  number: number;
  url: string;
  title: string;
  body: string;
  isDraft: boolean;
  labels: string[];
  comments: Array<{ body: string; url: string }>;
}

function haltedPr(): FakePr {
  return {
    number: 1412,
    url: PR_URL,
    title: `needs-remediation: ${BRANCH} — manual remediation required`,
    body: [
      'This PR was opened automatically after an irrecoverable daemon HALT.',
      NEEDS_REMEDIATION_BODY_MARKER,
    ].join('\n\n'),
    isDraft: true,
    labels: ['needs-remediation'],
    comments: [
      {
        body: `${NEEDS_REMEDIATION_MARKER}\n## Daemon halt\n\nbuild attempt exhausted`,
        url: COMMENT_URL,
      },
    ],
  };
}

function githubFake(pr: FakePr) {
  const calls: string[][] = [];

  const gh: GhRunner = async (args) => {
    calls.push([...args]);

    if (args[0] === 'pr' && args[1] === 'list') {
      const reconciliationRead = args.includes('number,url,body,isDraft,labels,headRefName');
      if (reconciliationRead) {
        return {
          stdout: JSON.stringify([
            {
              number: pr.number,
              url: pr.url,
              body: pr.body,
              isDraft: pr.isDraft,
              labels: pr.labels.map((name) => ({ name })),
              headRefName: BRANCH,
            },
          ]),
        };
      }
      return { stdout: JSON.stringify([{ url: pr.url, state: 'OPEN' }]) };
    }

    if (args[0] === 'pr' && args[1] === 'view') {
      const fields = String(args[args.indexOf('--json') + 1] ?? '').split(',');
      const view: Record<string, unknown> = {};
      if (fields.includes('url')) view.url = pr.url;
      if (fields.includes('state')) view.state = 'OPEN';
      if (fields.includes('title')) view.title = pr.title;
      if (fields.includes('body')) view.body = pr.body;
      if (fields.includes('isDraft')) view.isDraft = pr.isDraft;
      if (fields.includes('labels')) view.labels = pr.labels.map((name) => ({ name }));
      if (fields.includes('comments')) view.comments = pr.comments;
      return { stdout: JSON.stringify(view) };
    }

    if (args[0] === 'api' && args[2] === 'DELETE') {
      pr.labels = pr.labels.filter((label) => label !== 'needs-remediation');
      return { stdout: '' };
    }

    if (args[0] === 'api' && args[2] === 'POST' && /\/labels$/.test(args[3] ?? '')) {
      if (!pr.labels.includes('needs-remediation')) pr.labels.push('needs-remediation');
      return { stdout: '' };
    }

    if (args[0] === 'api' && args[2] === 'PATCH') {
      const bodyArg = args.find((arg) => arg.startsWith('body='));
      if (bodyArg) pr.comments[0].body = bodyArg.slice('body='.length);
      return { stdout: '' };
    }

    if (args[0] === 'pr' && args[1] === 'edit') {
      const bodyIndex = args.indexOf('--body');
      if (bodyIndex >= 0) pr.body = args[bodyIndex + 1] ?? '';
      const titleIndex = args.indexOf('--title');
      if (titleIndex >= 0) pr.title = args[titleIndex + 1] ?? '';
      return { stdout: '' };
    }

    if (args[0] === 'pr' && args[1] === 'comment') {
      pr.comments.push({ body: args[args.indexOf('--body') + 1] ?? '', url: COMMENT_URL });
      return { stdout: '' };
    }

    if (args[0] === 'pr' && args[1] === 'ready') {
      pr.isDraft = args.includes('--undo');
      return { stdout: '' };
    }

    return { stdout: '' };
  };

  return { gh, calls };
}

function isMutation(args: string[]): boolean {
  return (
    (args[0] === 'api' && ['DELETE', 'POST', 'PATCH'].includes(args[2] ?? '')) ||
    (args[0] === 'pr' && ['edit', 'comment', 'ready'].includes(args[1] ?? ''))
  );
}

describe('halt PR rehabilitation across daemon re-dispatch and reconciliation', () => {
  let projectRoot: string;
  let stateFilePath: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'halt-pr-rehabilitation-acceptance-'));
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    stateFilePath = join(projectRoot, '.pipeline', 'conduct-state.json');
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('clears the halt state before BUILD, preserves draft, then receives no sweep healing writes', async () => {
    const pr = haltedPr();
    const { gh, calls } = githubFake(pr);
    const state: ConductState = {
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      prd: 'skipped',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done',
      coherence_check: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
      build: 'pending',
      track: 'technical',
      complexity_tier: 'M',
      feature_desc: 'stuck widget',
      worktree_branch: BRANCH,
    };
    await writeState(stateFilePath, state);

    let stateSeenByBuild: FakePr | undefined;
    const runner: StepRunner = {
      run: async (step) => {
        if (step !== 'build') throw new Error(`unexpected dispatch: ${step}`);
        stateSeenByBuild = structuredClone(pr);
        return { success: false, output: 'sentinel: stop after BUILD observes the PR' };
      },
    };
    const git: GitRunner = async (args) => {
      if (args[0] === 'cat-file') throw new Error('no shipped record: feature is still building');
      return { stdout: '' };
    };

    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      mode: 'default',
      daemon: true,
      fromStep: 'build',
      maxRetries: 1,
      baseBranch: 'main',
      worktreeBranch: BRANCH,
      gh,
      runGh: gh,
      git,
      sleepFn: async () => {},
      escalateBuildFailure: async () => ({}),
    });

    await conductor.run();

    expect(stateSeenByBuild).toBeDefined();
    expect(stateSeenByBuild!.labels).not.toContain('needs-remediation');
    expect(stateSeenByBuild!.body).not.toContain(NEEDS_REMEDIATION_BODY_MARKER);
    expect(stateSeenByBuild!.isDraft).toBe(true);
    expect(stateSeenByBuild!.comments).toHaveLength(1);
    expect(stateSeenByBuild!.comments[0].body).toMatch(/resolved/i);

    const sweepStart = calls.length;
    await reconcileHaltPrs({ projectRoot, runGh: gh, runGit: git });
    expect(calls.slice(sweepStart).filter(isMutation)).toHaveLength(0);
    expect(pr.labels).not.toContain('needs-remediation');
  });

  it('still dispatches BUILD when GitHub is unavailable while recording the failed clear', async () => {
    await writeState(stateFilePath, {
      plan: 'done',
      acceptance_specs: 'done',
      build: 'pending',
      track: 'technical',
      feature_desc: 'stuck widget',
      worktree_branch: BRANCH,
    });

    let ghCallCount = 0;
    const unavailableGh: GhRunner = async () => {
      ghCallCount += 1;
      throw new Error('GitHub unavailable');
    };
    const logs: string[] = [];
    let buildDispatches = 0;
    const runner: StepRunner = {
      run: async (step) => {
        if (step !== 'build') throw new Error(`unexpected dispatch: ${step}`);
        buildDispatches += 1;
        return { success: false, output: 'sentinel: stop after BUILD dispatch' };
      },
    };

    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      mode: 'default',
      daemon: true,
      fromStep: 'build',
      maxRetries: 1,
      baseBranch: 'main',
      worktreeBranch: BRANCH,
      gh: unavailableGh,
      runGh: unavailableGh,
      git: async () => ({ stdout: '' }),
      log: (line) => logs.push(line),
      sleepFn: async () => {},
      escalateBuildFailure: async () => ({}),
    });

    await expect(conductor.run()).resolves.toBeUndefined();

    expect(buildDispatches).toBe(1);
    expect(ghCallCount).toBeGreaterThan(0);
    expect(logs.some((line) => /halt|retained|github/i.test(line))).toBe(true);
  });
});
