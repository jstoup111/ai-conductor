// Covers: task:5, task:6
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InvokeOptions, InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import {
  claimDigest,
  coverageBindingEnvelopePath,
  parseCoverageBindingEnvelope,
  writeCoverageBindingEnvelope,
  type CoverageBindingEnvelope,
  type CoverageBindingEnvelopeFilesystem,
} from '../../src/engine/coverage-binding-envelope.js';
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

function memoryEnvelopeFilesystem(files: Record<string, string> = {}) {
  const writes: CoverageBindingEnvelope[] = [];
  const filesystem: CoverageBindingEnvelopeFilesystem = {
    readFile: async (path) => {
      if (!(path in files)) throw new Error('missing');
      return files[path]!;
    },
    mkdir: async () => undefined,
    writeFile: async (path, contents) => { files[path] = contents; },
    rename: async (from, to) => {
      const envelope = parseCoverageBindingEnvelope(JSON.parse(files[from]!));
      if (envelope) writes.push(envelope);
      files[to] = files[from]!;
      delete files[from];
    },
  };
  return { files, filesystem, writes };
}

function entryFor(index: number) {
  const criterion = `Criterion ${index}`;
  const doneWhen = [[`Check ${index}.`]];
  return {
    digest: claimDigest({ criterion, doneWhen }),
    criterion,
    taskIds: [String(index)],
    doneWhen,
    verdict: 'asserts' as const,
  };
}

async function runBatches(count: number, batchSize: number, options: {
  plan?: string;
  filesystem?: CoverageBindingEnvelopeFilesystem;
  provider?: LLMProvider;
  events?: { emit(event: unknown): Promise<void> };
} = {}) {
  const projectDir = await mkdtemp(join(tmpdir(), 'coverage-binding-runner-'));
  const featureDesc = 'coverage-binding-runner';
  const planPath = join(projectDir, 'plan.md');
  await mkdir(join(projectDir, '.docs', 'coherence'), { recursive: true });
  await writeFile(planPath, options.plan ?? planText(count));
  await writeFile(join(projectDir, '.docs', 'coherence', `${featureDesc}.md`), coherenceText(count));
  const provider: LLMProvider = options.provider ?? {
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
    coverageBindingFilesystem: options.filesystem,
    events: options.events as never,
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

  it('checkpoints cached and not-applicable entries before the first batch dispatch', async () => {
    const envelope = memoryEnvelopeFilesystem();
    const plan = planText(20)
      .replace('### Task 13: Bind criterion 13\n**Done when:**\n- Check 13.\n', '### Task 13: Bind criterion 13\n')
      .replace('### Task 14: Bind criterion 14\n**Done when:**\n- Check 14.\n', '### Task 14: Bind criterion 14\n');
    const { projectDir, provider, runner } = await runBatches(20, 8, { plan, filesystem: envelope.filesystem });
    try {
      const path = coverageBindingEnvelopePath(projectDir);
      await writeCoverageBindingEnvelope(projectDir, {
        version: 1, slug: 'previous', runId: 'previous-run', status: 'partial', entries: Array.from({ length: 12 }, (_, index) => entryFor(index + 1)),
      }, envelope.filesystem);
      (provider.invoke as ReturnType<typeof vi.fn>).mockImplementationOnce(async (options: InvokeOptions) => {
        const checkpoint = parseCoverageBindingEnvelope(JSON.parse(envelope.files[path]!));
        expect(checkpoint).toMatchObject({ status: 'partial', entries: expect.arrayContaining([
          expect.objectContaining({ digest: entryFor(1).digest }),
          expect.objectContaining({ digest: claimDigest({ criterion: 'Criterion 13', doneWhen: [] }), verdict: 'not-applicable' }),
          expect.objectContaining({ digest: claimDigest({ criterion: 'Criterion 14', doneWhen: [] }), verdict: 'not-applicable' }),
        ]) });
        expect(checkpoint?.entries).toHaveLength(14);
        return { success: true, output: JSON.stringify({ verdicts: promptClaims(options).map(({ digest }) => ({ digest, verdict: 'asserts' })) }), exitCode: 0 };
      });
      await expect(runner.run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({ success: true });
      expect(provider.invoke).toHaveBeenCalledTimes(1);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('checkpoints every accepted batch before dispatching the next one', async () => {
    const envelope = memoryEnvelopeFilesystem();
    const { projectDir, provider, runner } = await runBatches(20, 8, { filesystem: envelope.filesystem });
    try {
      const path = coverageBindingEnvelopePath(projectDir);
      (provider.invoke as ReturnType<typeof vi.fn>).mockImplementation(async (options: InvokeOptions) => {
        if ((provider.invoke as ReturnType<typeof vi.fn>).mock.calls.length === 2) {
          const checkpoint = parseCoverageBindingEnvelope(JSON.parse(envelope.files[path]!));
          expect(checkpoint).toMatchObject({ status: 'partial' });
          expect(checkpoint?.entries).toHaveLength(8);
        }
        return { success: true, output: JSON.stringify({ verdicts: promptClaims(options).map(({ digest }) => ({ digest, verdict: 'asserts' })) }), exitCode: 0 };
      });
      await expect(runner.run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({ success: true });
      expect(envelope.writes.map(({ status, entries }) => [status, entries.length])).toEqual([
        ['partial', 0], ['partial', 8], ['partial', 16], ['partial', 20], ['done', 20],
      ]);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('resumes a partial envelope and ends all-asserts runs as done with one event per claim', async () => {
    const envelope = memoryEnvelopeFilesystem();
    const events: unknown[] = [];
    const { projectDir, provider, runner } = await runBatches(20, 8, {
      filesystem: envelope.filesystem,
      events: { emit: async (event) => { events.push(event); } },
    });
    try {
      await writeCoverageBindingEnvelope(projectDir, {
        version: 1, slug: 'previous', runId: 'previous-run', status: 'partial', entries: Array.from({ length: 16 }, (_, index) => entryFor(index + 1)),
      }, envelope.filesystem);
      await expect(runner.run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({ success: true });
      expect(provider.invoke).toHaveBeenCalledTimes(1);
      expect(promptClaims((provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0]![0] as InvokeOptions)).toHaveLength(4);
      expect(envelope.writes.at(-1)).toMatchObject({ status: 'done' });
      expect(envelope.writes.at(-1)?.entries).toHaveLength(20);
      expect(events.filter((event) => (event as { type?: string }).type === 'coverage_binding_judged')).toHaveLength(20);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});
