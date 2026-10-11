import { describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import {
  coverageBindingEnvelopePath,
  parseCoverageBindingEnvelope,
} from '../../src/engine/coverage-binding-envelope.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { currentPreservedJudgeIdentity } from '../../src/engine/gate-code-validity.js';

const PLAN = [
  '# Plan',
  '',
  '### Task 1: Bind criterion 1',
  '**Done when:**',
  '- Check 1.',
  '',
].join('\n');

const COHERENCE = [
  '| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |',
  '| --- | --- | --- | --- | --- | --- |',
  '| criterion | Criterion 1 | task-1 | covered | "Check 1." | diff-local |',
].join('\n');

async function setup() {
  const projectDir = await mkdtemp(join(tmpdir(), 'coverage-binding-noop-'));
  const featureDesc = 'coverage-binding-noop';
  const planPath = join(projectDir, 'plan.md');
  await mkdir(join(projectDir, '.docs', 'coherence'), { recursive: true });
  await writeFile(planPath, PLAN);
  await writeFile(join(projectDir, '.docs', 'coherence', `${featureDesc}.md`), COHERENCE);
  const provider: LLMProvider = {
    lifecycleCapability: { synchronousSpawnPermit: true },
    invoke: vi.fn(),
  };
  const events: unknown[] = [];
  const runner = new DefaultStepRunner(provider, 'coverage-binding-noop', projectDir, {
    featureDesc,
    planPath,
    // The retired judge settings still load; the step ignores them.
    config: { coverage_binding: { judge: { enabled: true, batch_size: 1 } } },
    events: { emit: async (event: unknown) => { events.push(event); } } as never,
  });
  return { projectDir, provider, runner, events };
}

describe('coverage_binding no-op runner', () => {
  it('completes without a provider dispatch and records an entry-free disabled envelope even with the retired judge configured on', async () => {
    const { projectDir, provider, runner, events } = await setup();
    try {
      await expect(runner.run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({ success: true });
      expect(provider.invoke).not.toHaveBeenCalled();
      const envelope = parseCoverageBindingEnvelope(JSON.parse(await readFile(coverageBindingEnvelopePath(projectDir), 'utf8')));
      expect(envelope).toMatchObject({ status: 'disabled', entries: [] });
      expect(events).toEqual([{ type: 'coverage_binding_disabled', step: 'coverage_binding' }]);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('stamps the recorded HEAD so the production envelope yields a preserved identity', async () => {
    const { projectDir, runner } = await setup();
    try {
      const git = (...args: string[]) => promisify(execFile)('git', ['-C', projectDir, ...args]);
      await git('init', '-q', '-b', 'main');
      await git('-c', 'user.email=t@example.com', '-c', 'user.name=T', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'recorded');
      const head = (await git('rev-parse', 'HEAD')).stdout.trim();

      await expect(runner.run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({ success: true });

      const envelope = parseCoverageBindingEnvelope(JSON.parse(await readFile(coverageBindingEnvelopePath(projectDir), 'utf8')));
      expect(envelope?.status).toBe('disabled');
      await expect(currentPreservedJudgeIdentity(projectDir, 'coverage_binding')).resolves.toMatchObject({
        runId: envelope!.runId, attemptId: envelope!.runId, codeStamp: head,
      });
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});
