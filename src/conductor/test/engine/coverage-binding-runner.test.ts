// Covers: task:5
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InvokeOptions, InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import { claimDigest } from '../../src/engine/coverage-binding-envelope.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';

const FRESH_SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PromptClaim {
  readonly digest: string;
  readonly criterion: string;
  readonly taskIds: readonly string[];
  readonly doneWhen: readonly (readonly string[])[];
}

function promptClaims(options: InvokeOptions): PromptClaim[] {
  const body = options.prompt.slice(options.prompt.lastIndexOf('\n\n{') + 2);
  return (JSON.parse(body) as { claims: PromptClaim[] }).claims;
}

function planText(count: number): string {
  return Array.from({ length: count }, (_, index) => `### Task ${index + 1}: Bind criterion ${index + 1}\n**Done when:**\n- Check ${index + 1}.\n`).join('\n');
}

function coherenceText(count: number): string {
  const rows = Array.from({ length: count }, (_, index) =>
    `| criterion | Criterion ${index + 1} | task-${index + 1} | covered | "Check ${index + 1}." | diff-local |`,
  );
  return ['| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |', '| --- | --- | --- | --- | --- | --- |', ...rows].join('\n');
}

async function runBatches(count: number, batchSize: number) {
  const projectDir = await mkdtemp(join(tmpdir(), 'coverage-binding-runner-'));
  const featureDesc = 'coverage-binding-runner';
  const planPath = join(projectDir, 'plan.md');
  await mkdir(join(projectDir, '.docs', 'coherence'), { recursive: true });
  await writeFile(planPath, planText(count));
  await writeFile(join(projectDir, '.docs', 'coherence', `${featureDesc}.md`), coherenceText(count));
  const provider: LLMProvider = {
    lifecycleCapability: { synchronousSpawnPermit: true },
    invoke: vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => ({
      success: true,
      output: JSON.stringify({ verdicts: promptClaims(options).map(({ digest }) => ({ digest, verdict: 'asserts' })) }),
      exitCode: 0,
    })),
  };
  const runner = new DefaultStepRunner(provider, 'coverage-runner', projectDir, {
    featureDesc,
    planPath,
    config: { coverage_binding: { judge: { enabled: true, batch_size: batchSize } } },
  });
  return { projectDir, provider, runner };
}

describe('coverage-binding runner batches', () => {
  it('dispatches digest-stamped claim batches through fresh sessions', async () => {
    const { projectDir, provider, runner } = await runBatches(20, 8);
    try {
      await expect(runner.run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({ success: true });
      const calls = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls.map(([options]) => options as InvokeOptions);
      expect(calls).toHaveLength(3);
      expect(calls.map((options) => promptClaims(options))).toHaveLength(3);
      expect(calls.map((options) => promptClaims(options).length)).toEqual([8, 8, 4]);
      expect(calls.map((options) => options.sessionId)).toSatisfy((ids: unknown[]) =>
        new Set(ids).size === ids.length && ids.every((id) => typeof id === 'string' && FRESH_SESSION_ID_RE.test(id)),
      );
      expect(calls.every((options) => options.resume === false)).toBe(true);
      expect(calls.every((options) => options.prompt.startsWith('/coverage-binding\n\n'))).toBe(true);
      for (const options of calls) {
        for (const claim of promptClaims(options)) {
          expect(Object.keys(claim).sort()).toEqual(['criterion', 'digest', 'doneWhen', 'taskIds']);
          expect(claim.digest).toBe(claimDigest(claim));
        }
      }
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('reads batch_size from coverage_binding config', async () => {
    const { projectDir, provider, runner } = await runBatches(5, 1);
    try {
      await expect(runner.run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({ success: true });
      expect(provider.invoke).toHaveBeenCalledTimes(5);
      for (const [options] of (provider.invoke as ReturnType<typeof vi.fn>).mock.calls) {
        expect(promptClaims(options as InvokeOptions)).toHaveLength(1);
      }
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});
