// Covers: task:6 — dispatch-time preparation of project-owned PR body regions.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Conductor, type StepRunResult, type StepRunner } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { GithubOperationRequest, GithubOperationRunner, GithubOperationRunnerResponse } from '../../src/engine/github-operations.js';
import type { GhRunner, GitRunner } from '../../src/engine/pr-labels.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { StepName } from '../../src/types/index.js';

const BRANCH = 'feat/project-owned-region';
const PR_URL = 'https://github.com/acme/widget/pull/42';
const OWNER = 'compliance-attest' as StepName;
const TEMPLATE_BYTES = '\nAttested-By: security-bot\n';
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function config(extraSteps: HarnessConfig['steps'] = {}): HarnessConfig {
  return {
    steps: {
      [OWNER]: { after: 'build_review', skill: '.agents/skills/compliance/SKILL.md', enforcement: 'gating' },
      ...extraSteps,
    },
    pr_template_region_owners: { [OWNER]: TEMPLATE_BYTES },
  } as HarnessConfig;
}

function retainedDraftGh(input: { body: string; failBodyRead?: boolean; missingDraft?: boolean }): {
  gh: GhRunner;
  reads: string[][];
} {
  const reads: string[][] = [];
  let views = 0;
  const gh: GhRunner = async (args) => {
    reads.push([...args]);
    if (args[0] === 'pr' && args[1] === 'list') {
      return { stdout: JSON.stringify(input.missingDraft ? [] : [{ url: PR_URL, state: 'OPEN' }]) };
    }
    if (args[0] === 'pr' && args[1] === 'view') {
      views += 1;
      // The first read is retained-PR presentation; the next reads its body.
      if (input.failBodyRead && views > 1) throw new Error('GitHub body unavailable');
      return { stdout: JSON.stringify({ title: 'feat: widget', isDraft: true, labels: [], comments: [], body: input.body }) };
    }
    if (args[0] === 'api' && args[1] === 'user') return { stdout: 'alice\n' };
    return { stdout: '{}' };
  };
  return { gh, reads };
}

function git(): GitRunner {
  return async (args) => {
    if (args[0] === 'config' || args[0] === 'remote') return { stdout: 'https://github.com/acme/widget.git\n' };
    if (args[0] === 'show') return { stdout: 'Owner: alice\n' };
    return { stdout: '' };
  };
}

async function fixture(input: {
  body?: string;
  failBodyRead?: boolean;
  missingDraft?: boolean;
  refusal?: boolean;
  start?: StepName;
  extraSteps?: HarnessConfig['steps'];
} = {}): Promise<{
  root: string;
  calls: StepName[];
  reads: string[][];
  edits: GithubOperationRequest[];
  prepare: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), 'pr-body-region-dispatch-'));
  roots.push(root);
  await writeFile(join(root, 'conduct-state.json'), JSON.stringify({ worktree_branch: BRANCH, feature_desc: 'region fixture' }));
  const { gh, reads } = retainedDraftGh({ body: input.body ?? 'before\n\nafter', failBodyRead: input.failBodyRead, missingDraft: input.missingDraft });
  const edits: GithubOperationRequest[] = [];
  const operations: GithubOperationRunner = {
    run: async (request) => {
      edits.push(request);
      return input.refusal ? { kind: 'refused', reason: 'other-owner' } : {} as GithubOperationRunnerResponse;
    },
  };
  const calls: StepName[] = [];
  const runner: StepRunner = {
    // A controlled failure ends this fixture at the dispatch boundary.
    run: async (step): Promise<StepRunResult> => {
      calls.push(step);
      return { success: false, output: 'sentinel: stop after dispatch' };
    },
  };
  const conductor = new Conductor({
    stateFilePath: join(root, 'conduct-state.json'),
    stepRunner: runner,
    events: new ConductorEventEmitter(),
    projectRoot: root,
    config: config(input.extraSteps),
    fromStep: input.start ?? OWNER,
    gh,
    runGh: gh,
    git: git(),
    baseBranch: 'main',
    maxRetries: 1,
    log: () => {},
    resolveShipDraftPublicationDependencies: async () => ({ operations }) as never,
  });
  const step = input.start ?? OWNER;
  const prepare = () => (conductor as unknown as {
    ensureOwnedStepRegion(state: { worktree_branch: string; feature_desc: string }, owner: StepName): Promise<void>;
  }).ensureOwnedStepRegion({ worktree_branch: BRANCH, feature_desc: 'region fixture' }, step);
  return { root, calls, reads, edits, prepare };
}

describe('project-owned region dispatch preparation', () => {
  it('inserts an absent owner region through exactly one guarded edit before dispatch, preserving every other byte', async () => {
    const subject = await fixture({ body: 'before\n\nafter' });

    await subject.prepare();

    expect(subject.edits).toHaveLength(1);
    expect(subject.edits[0]).toMatchObject({
      operation: 'pull-request.edit',
      payload: {
        body: 'before\n\nafter\n\n<!-- ai-conductor:step compliance-attest -->\nAttested-By: security-bot\n<!-- /ai-conductor:step -->',
      },
    });
  });

  it('leaves an existing owner region unchanged and makes no guarded edit', async () => {
    const body = 'before\n<!-- ai-conductor:step compliance-attest -->\nAttested-By: project-owner\n<!-- /ai-conductor:step -->\nafter';
    const subject = await fixture({ body });

    await subject.prepare();

    expect(subject.edits).toEqual([]);
  });

  it('does not read or edit a pull request for a step that owns no region', async () => {
    const subject = await fixture({
      start: 'docs-check' as StepName,
      extraSteps: { 'docs-check': { after: OWNER, skill: '.agents/skills/docs/SKILL.md', enforcement: 'gating' } },
    });

    await subject.prepare();

    expect(subject.reads).toEqual([]);
    expect(subject.edits).toEqual([]);
  });

  it.each([
    ['refused guarded edit', { refusal: true }, 'guarded edit refused'],
    ['failed body read', { failBodyRead: true }, 'body read failed'],
    ['missing retained draft', { missingDraft: true }, 'retained draft PR is missing'],
  ] as const)('halts without dispatch when preparation has a %s', async (_name, input, expectedReason) => {
    const subject = await fixture(input);

    await expect(subject.prepare()).rejects.toThrow(expectedReason);

    expect(subject.calls).toEqual([]);
    await expect(readFile(join(subject.root, '.pipeline/HALT'), 'utf8')).resolves.toEqual(
      expect.stringContaining(`project-owned region for ${OWNER} cannot be prepared: ${expectedReason}`),
    );
  });
});
