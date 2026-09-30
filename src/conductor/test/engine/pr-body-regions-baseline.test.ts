// Covers: task:12 — no declared region leaves production FINISH composition unchanged.
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StepRunner } from '../../src/engine/conductor.js';
import { Conductor } from '../test-conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { createProductionFinishPublicationCoordinator } from '../../src/engine/finish-publication-production.js';
import { shipDraftPrBody } from '../../src/engine/ship-draft-pr.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { ConductState } from '../../src/types/index.js';
import type { GithubOperationRequest, GithubOperationRunner } from '../../src/engine/github-operations.js';

const PR_URL = 'https://github.com/acme/widget/pull/12';
const UNMARKED_CONTRIBUTION = 'Custom step contribution that is not region-owned.';

async function runNoRegionFinish(input: { config?: HarnessConfig; template?: string }) {
  const root = await mkdtemp(join(tmpdir(), 'pr-body-regions-baseline-'));
  const pipeline = join(root, '.pipeline');
  await Promise.all([mkdir(pipeline, { recursive: true }), mkdir(join(root, '.docs', 'plans'), { recursive: true }), mkdir(join(root, '.docs', 'shipped'), { recursive: true })]);
  await Promise.all([
    writeFile(join(pipeline, 'finish-choice'), 'pr\n'),
    writeFile(join(root, '.docs', 'plans', 'no-region-baseline.md'), '# Plan\n'),
    writeFile(join(root, '.docs', 'shipped', 'no-region-baseline.md'), '---\nslug: no-region-baseline\n---\n'),
  ]);
  let body = shipDraftPrBody('no-region-baseline', input.template);
  let draft = true;
  const githubBodyReads = vi.fn(async () => ({ stdout: JSON.stringify({ url: PR_URL, title: 'feat: no-region baseline', body, isDraft: draft, labels: [] }) }));
  const operations: GithubOperationRunner = { run: async (request: GithubOperationRequest) => {
    if (request.operation === 'pull-request.edit') body = (request.payload as { body: string }).body;
    if (request.operation === 'pull-request.ready') draft = false;
    return {} as never;
  } };
  const runner: StepRunner = { run: vi.fn(async (_step, _state, options) => {
    expect(options?.finishProsePass).toBe('author');
    body = '## Why\n\nAuthored prose from the provider.\n\n## What Changed\n\n- Baseline change.\n\n## Testing\n\n- Focused fixture.';
    return { success: true };
  }) };
  const coordinator = createProductionFinishPublicationCoordinator({
    projectRoot: root, stateFilePath: join(pipeline, 'conduct-state.json'), baseBranch: 'main', prTemplateBytes: input.template,
    git: async (args) => args[0] === 'rev-parse' ? { stdout: 'refs/remotes/origin/feat/no-region-baseline\n' } : { stdout: '' },
    gh: githubBodyReads, operations, observeReleaseReadiness: async () => 'present', repairPresentation: async () => {}, recordFinish: async () => 0,
  });
  const conductor = new Conductor({
    stateFilePath: join(pipeline, 'conduct-state.json'), stepRunner: runner, finishPublication: coordinator, events: new ConductorEventEmitter(), projectRoot: root, mode: 'auto', daemon: true,
    ...(input.config === undefined ? {} : { config: input.config }), gh: githubBodyReads, git: async () => ({ stdout: '' }), runGh: async () => ({ stdout: '' }),
  });
  const state = {
    feature_desc: 'no-region-baseline', worktree_branch: 'feat/no-region-baseline', complexity_tier: 'S', pr_url: PR_URL,
    track: 'technical', build_review: 'done', test_suite: 'done', manual_test: 'skipped', prd_audit: 'done', architecture_review_as_built: 'done', rebase: 'done',
  } as ConductState;
  for (let attempt = 0; attempt < 8 && draft; attempt += 1) {
    await (conductor as unknown as { runFinishPublication(state: ConductState, options: never): Promise<unknown> }).runFinishPublication(state, {} as never);
  }
  return { root, body: () => body, githubBodyReads };
}

describe('no-region FINISH baseline', () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

  it.each([
    ['unmarked-template', '## Project instructions\n\nKeep this unmarked.\n'],
    ['no-template', undefined],
  ])('matches the c50ca7651 golden final body for %s', async (name, template) => {
    const result = await runNoRegionFinish({ template, config: template === undefined ? undefined : { pr_template_bytes: template } });
    roots.push(result.root);
    const golden = await readFile(join(import.meta.dirname, '..', 'fixtures', `pr-body-regions-baseline-${name}.md`), 'utf8');
    expect(result.body()).toBe(golden.replace(/^<!-- Recorded from c50ca7651 -->\n/, ''));
  });

  it('does not write a capture or issue a region-verification read with no template', async () => {
    const result = await runNoRegionFinish({});
    roots.push(result.root);
    await expect(readFile(join(result.root, '.pipeline', 'pr-body-region-captures.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not restore an unmarked custom-step contribution omitted by authoring', async () => {
    const template = `## Project instructions\n\n${UNMARKED_CONTRIBUTION}\n`;
    const result = await runNoRegionFinish({ config: { pr_template_bytes: template, pr_template_region_owners: {} }, template });
    roots.push(result.root);
    expect(result.body()).not.toContain(UNMARKED_CONTRIBUTION);
    await expect(readFile(join(result.root, '.pipeline', 'HALT'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
