// Covers: task:12 — no declared region leaves FINISH body composition unchanged.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StepRunner } from '../../src/engine/conductor.js';
import { Conductor } from '../test-conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { ConductState } from '../../src/types/index.js';

const PR_URL = 'https://github.com/acme/widget/pull/12';
const GOLDEN_FINAL_BODY = [
  '## Why',
  '',
  'The engine now preserves the project-owned sections it was asked to preserve.',
  '',
  '## What changed',
  '',
  '- Added the requested behavior.',
  '',
].join('\n');

const UNMARKED_CONTRIBUTION = 'Custom step contribution that is not region-owned.';

async function runNoRegionFinish(input: {
  config?: HarnessConfig;
  initialBody: string;
}): Promise<{
  root: string;
  body: () => string;
  githubBodyReads: ReturnType<typeof vi.fn>;
}> {
  const root = await mkdtemp(join(tmpdir(), 'pr-body-regions-baseline-'));
  let body = input.initialBody;
  const githubBodyReads = vi.fn(async () => ({ stdout: JSON.stringify({ body }) }));
  const runner: StepRunner = {
    run: vi.fn(async (_step, _state, options) => {
      expect(options?.finishProsePass).toBe('author');
      // This is the provider boundary. Its emitted body is the golden body
      // recorded from c50ca7651 for these authoring inputs.
      body = GOLDEN_FINAL_BODY;
      return { success: true };
    }),
  };
  const finishPublication = {
    advance: vi.fn(async ({ dispatchAuthoring }) => {
      await dispatchAuthoring({
        kind: 'author_pr_prose',
        pullRequestUrl: PR_URL,
        revisionGuidance: undefined,
      });
      return { kind: 'complete' } as const;
    }),
  };
  const conductor = new Conductor({
    stateFilePath: join(root, '.pipeline', 'conduct-state.json'),
    stepRunner: runner,
    finishPublication,
    events: new ConductorEventEmitter(),
    projectRoot: root,
    ...(input.config === undefined ? {} : { config: input.config }),
    gh: githubBodyReads,
    git: async () => ({ stdout: '' }),
    runGh: async () => ({ stdout: '' }),
  });

  await (conductor as unknown as {
    runFinishPublication(state: ConductState, options: never): Promise<unknown>;
  }).runFinishPublication({
    feature_desc: 'no-region-baseline',
    worktree_branch: 'feat/no-region-baseline',
    complexity_tier: 'S',
  } as ConductState, {} as never);

  return { root, body: () => body, githubBodyReads };
}

describe('no-region FINISH baseline', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('keeps the c50ca7651 final body with an unmarked template', async () => {
    const result = await runNoRegionFinish({
      config: { pr_template_bytes: '## Project instructions\n\nKeep this unmarked.\n' },
      initialBody: '## Project instructions\n\nKeep this unmarked.\n',
    });
    roots.push(result.root);

    expect(result.body()).toBe(GOLDEN_FINAL_BODY);
    expect(result.githubBodyReads).not.toHaveBeenCalled();
  });

  it('keeps the c50ca7651 final body with no template', async () => {
    const result = await runNoRegionFinish({ initialBody: '' });
    roots.push(result.root);

    expect(result.body()).toBe(GOLDEN_FINAL_BODY);
  });

  it('does not write a capture or issue a region-verification read with no template', async () => {
    const result = await runNoRegionFinish({ initialBody: '' });
    roots.push(result.root);

    await expect(readFile(join(result.root, '.pipeline', 'pr-body-region-captures.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect(result.githubBodyReads).not.toHaveBeenCalled();
  });

  it('does not restore an unmarked custom-step contribution omitted by authoring', async () => {
    const result = await runNoRegionFinish({
      config: {
        pr_template_bytes: `## Project instructions\n\n${UNMARKED_CONTRIBUTION}\n`,
        pr_template_region_owners: {},
      },
      initialBody: `## Project instructions\n\n${UNMARKED_CONTRIBUTION}\n`,
    });
    roots.push(result.root);

    expect(result.body()).toBe(GOLDEN_FINAL_BODY);
    expect(result.body()).not.toContain(UNMARKED_CONTRIBUTION);
    await expect(readFile(join(result.root, '.pipeline', 'HALT'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
});
