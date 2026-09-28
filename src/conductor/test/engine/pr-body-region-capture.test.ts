// Covers: task:7 — completion-time capture of project-owned PR body regions.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readRegionCaptures, writeRegionCapture } from '../../src/engine/pr-body-region-store.js';
import type { GhRunner } from '../../src/engine/pr-labels.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { ConductState, StepName } from '../../src/types/index.js';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

const OWNER = 'compliance-attest' as StepName;
const PR_URL = 'https://github.com/acme/widget/pull/42';
const BRANCH = 'feat/project-owned-region';
const CAPTURE_FILE = '.pipeline/pr-body-region-captures.json';
const ownerConfig: HarnessConfig = {
  steps: { [OWNER]: { after: 'build_review', skill: '.agents/skills/compliance/SKILL.md', enforcement: 'gating' } },
  pr_template_region_owners: { [OWNER]: '\nTemplate placeholder\n' },
} as HarnessConfig;

function ownerBody(bytes: string): string {
  return `## Summary\n\n<!-- ai-conductor:step ${OWNER} -->${bytes}<!-- /ai-conductor:step -->`;
}

async function subject(input: { body: string; failRead?: boolean; config?: HarnessConfig } = { body: ownerBody('\nAttested-By: bot\n') }) {
  const root = await mkdtemp(join(tmpdir(), 'region-capture-')); dirs.push(root);
  await writeFile(join(root, 'conduct-state.json'), JSON.stringify({ worktree_branch: BRANCH, feature_desc: 'capture fixture' }));
  const views = vi.fn(async () => {
    if (input.failRead) throw new Error('GitHub body unavailable');
    return { stdout: JSON.stringify({ body: input.body }) };
  });
  const gh: GhRunner = async (args) => {
    if (args[0] === 'pr' && args[1] === 'list') return { stdout: JSON.stringify([{ url: PR_URL, state: 'OPEN' }]) };
    if (args[0] === 'pr' && args[1] === 'view') return views();
    return { stdout: '{}' };
  };
  const runner = { run: vi.fn(async () => ({ success: true })) };
  const conductor = new Conductor({
    stateFilePath: join(root, 'conduct-state.json'),
    stepRunner: runner, events: new ConductorEventEmitter(),
    projectRoot: root, config: input.config ?? ownerConfig, gh, runGh: gh, baseBranch: 'main', maxRetries: 1, log: () => {},
  });
  (conductor as unknown as { shipDraftPrUrl: string }).shipDraftPrUrl = PR_URL;
  const capture = () => (conductor as unknown as {
    captureOwnedStepRegion(state: ConductState, step: StepName): Promise<void>;
  }).captureOwnedStepRegion({ worktree_branch: BRANCH, feature_desc: 'capture fixture' } as ConductState, OWNER);
  const discard = () => (conductor as unknown as {
    discardOwnedStepRegionCapture(state: ConductState, step: StepName): Promise<void>;
  }).discardOwnedStepRegionCapture({ worktree_branch: BRANCH, feature_desc: 'capture fixture' } as ConductState, OWNER);
  return { root, capture, discard, views, conductor, runner, gh };
}

describe('project-owned region capture', () => {
  it('captures the exact bytes when its owner reports done', async () => {
    const bytes = '\r\nAttested-By: security-bot\r\n<!-- opaque -->\r\n';
    const fixture = await subject({ body: ownerBody(bytes) });

    await fixture.capture();

    await expect(readRegionCaptures(fixture.root, PR_URL)).resolves.toEqual({ [OWNER]: bytes });
    expect(fixture.views).toHaveBeenCalledOnce();
  });

  it('keeps a persisted capture across a restart without another completion read', async () => {
    const first = await subject({ body: ownerBody('\nAttested-By: first\n') });
    await first.capture();
    const restarted = await subject({ body: ownerBody('\nAttested-By: changed\n') });
    await writeRegionCapture(restarted.root, PR_URL, OWNER, '\nAttested-By: first\n');

    await expect(readRegionCaptures(restarted.root, PR_URL)).resolves.toEqual({ [OWNER]: '\nAttested-By: first\n' });
    expect(restarted.views).not.toHaveBeenCalled();
  });

  it('discards a prior capture on re-dispatch and replaces it only after the new owner succeeds', async () => {
    const fixture = await subject({ body: ownerBody('\nAttested-By: second\n') });
    await writeRegionCapture(fixture.root, PR_URL, OWNER, '\nAttested-By: first\n');

    await fixture.discard();
    await expect(readRegionCaptures(fixture.root, PR_URL)).resolves.toEqual({});
    await fixture.capture();
    await expect(readRegionCaptures(fixture.root, PR_URL)).resolves.toEqual({ [OWNER]: '\nAttested-By: second\n' });
  });

  it.each([
    ['removed markers', { body: '## Summary\n' }, 'region is missing'],
    ['an empty region', { body: ownerBody('\n<!-- placeholder -->\n') }, 'region is empty'],
    ['a failed body read', { body: ownerBody('\nAttested-By: bot\n'), failRead: true }, 'body read failed'],
  ])('rejects %s with a step-named capture error', async (_name, input, reason) => {
    const fixture = await subject(input);

    await expect(fixture.capture()).rejects.toThrow(`project-owned region capture for ${OWNER} failed: ${reason}`);
    await expect(readFile(join(fixture.root, CAPTURE_FILE), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not capture a failed owner step', async () => {
    const fixture = await subject();
    const runner: StepRunner = { run: vi.fn(async () => ({ success: false, output: 'owner failed' })) };
    const conductor = new Conductor({
      stateFilePath: join(fixture.root, 'failed-state.json'), stepRunner: runner, events: new ConductorEventEmitter(),
      projectRoot: fixture.root, config: ownerConfig, fromStep: OWNER, gh: fixture.gh, runGh: fixture.gh,
      baseBranch: 'main', maxRetries: 1, log: () => {},
    });
    // `fromStep` still honors the owner's immediate `after` dependency.
    // Seed only that prerequisite so this bounded run reaches the failed
    // owner rather than passing because it was never dispatched.
    await writeFile(join(fixture.root, 'failed-state.json'), JSON.stringify({
      feature_desc: 'failed owner', worktree_branch: BRANCH, build_review: 'done',
    }));

    await conductor.run();

    expect(runner.run).toHaveBeenCalledOnce();
    await expect(readFile(join(fixture.root, CAPTURE_FILE), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not create a capture file when the repository declares no template regions', async () => {
    const fixture = await subject({ body: ownerBody('\nAttested-By: bot\n'), config: {} });

    await fixture.capture();

    await expect(readFile(join(fixture.root, CAPTURE_FILE), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
