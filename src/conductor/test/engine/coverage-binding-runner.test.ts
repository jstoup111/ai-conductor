// Covers: task:5, task:6, task:7, task:14
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
import { CoverageBindingPayloadError, DefaultStepRunner } from '../../src/engine/step-runners.js';
import { currentPreservedJudgeIdentity } from '../../src/engine/gate-code-validity.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { resolveProviderModelPolicy } from '../../src/engine/provider-model-policy.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import type { HarnessConfig } from '../../src/types/config.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';

const FRESH_SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PromptClaim {
  readonly id: string;
  readonly criterion: string;
  readonly taskIds: readonly string[];
  readonly doneWhen: readonly (readonly string[])[];
}

function promptClaims(options: InvokeOptions): PromptClaim[] {
  const body = options.prompt.slice(options.prompt.lastIndexOf('\n\n{') + 2);
  return (JSON.parse(body) as { claims: PromptClaim[] }).claims;
}

/** The engine-side identity of a claim the judge was shown by opaque id. */
function promptDigest(claim: PromptClaim): string {
  return claimDigest({ criterion: claim.criterion, doneWhen: claim.doneWhen });
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
      output: JSON.stringify({ verdicts: promptClaims(options).map(({ id }) => ({ id, verdict: 'asserts' })) }),
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

const TIER_S_ADR_AMENDMENT = '> **Amended 2026-10-04 by #2750:**\n> **D7 — The branch amendment introduces this citable decision.**';

async function runTierSAdrAmendment(options: { enabled: boolean; inherited?: boolean; amendmentVerdict?: 'carried' | 'not-carried' }) {
  const projectDir = await mkdtemp(join(tmpdir(), 'coverage-binding-tier-s-amendment-'));
  const planPath = join(projectDir, '.docs', 'plans', 'tier-s.md');
  const adrPath = join(projectDir, '.docs', 'decisions', 'adr-tier-s.md');
  const baseAdr = '# ADR\n\n**Status:** APPROVED\n\n## Decision\n\n1. The existing decision remains citable.\n';
  const branchAdr = `${baseAdr}\n${TIER_S_ADR_AMENDMENT}\n`;
  const git = (...args: string[]) => promisify(execFile)('git', ['-C', projectDir, ...args]);
  const prompts: string[] = [];

  await mkdir(join(projectDir, '.docs', 'plans'), { recursive: true });
  await mkdir(join(projectDir, '.docs', 'stories'), { recursive: true });
  await mkdir(join(projectDir, '.docs', 'decisions'), { recursive: true });
  await writeFile(planPath, `**Stories:** .docs/stories/tier-s.md\n\n### Task 1: Carry the tier-S obligation\n**Done when:**\n- The tier-S obligation is carried.\n`);
  await writeFile(join(projectDir, '.docs', 'stories', 'tier-s.md'), '# Stories\n');
  await writeFile(adrPath, options.inherited ? `${baseAdr}\n${TIER_S_ADR_AMENDMENT}\n` : baseAdr);
  await git('init', '-q', '-b', 'main');
  await git('add', '.');
  await git('-c', 'user.email=t@example.com', '-c', 'user.name=T', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'base');
  const baseSha = (await git('rev-parse', 'HEAD')).stdout.trim();
  await git('remote', 'add', 'origin', '.');
  await git('fetch', '-q', 'origin', 'main:refs/remotes/origin/main');
  await git('checkout', '-q', '-b', 'feature');
  await writeFile(adrPath, options.inherited ? `${baseAdr}\n${TIER_S_ADR_AMENDMENT}\n\nBranch text changed.\n` : branchAdr);
  await git('add', '.');
  await git('-c', 'user.email=t@example.com', '-c', 'user.name=T', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'amend ADR');
  const headSha = (await git('rev-parse', 'HEAD')).stdout.trim();

  const provider: LLMProvider = {
    lifecycleCapability: { synchronousSpawnPermit: true },
    invoke: vi.fn(async (invokeOptions: InvokeOptions): Promise<InvokeResult> => {
      prompts.push(invokeOptions.prompt);
      const claims = promptClaims(invokeOptions);
      if (invokeOptions.prompt.includes('DECIDE amendment')) {
        return {
          success: true,
          output: JSON.stringify({ verdicts: claims.map(({ id }) => options.amendmentVerdict === 'not-carried'
            ? { id, verdict: 'not-carried', missingObligation: 'Carry D7 in a plan task.' }
            : { id, verdict: 'carried', taskIds: ['1'] }) }),
          exitCode: 0,
        };
      }
      return {
        success: true,
        output: JSON.stringify({ verdicts: claims.map(({ id }) => ({ id, verdict: 'consistent' })) }),
        exitCode: 0,
      };
    }),
  };
  const gitRunner = vi.fn(async (args: string[]) => {
    if (args[0] === 'rev-parse' && args[1] === 'HEAD') return { exitCode: 0, stdout: `${headSha}\n`, stderr: '' };
    if (args[0] === 'merge-base') return { exitCode: 0, stdout: `${baseSha}\n`, stderr: '' };
    if (args[0] === 'cat-file') return { exitCode: 0, stdout: '', stderr: '' };
    if (args[0] === 'show') return { exitCode: 0, stdout: options.inherited ? `${baseAdr}\n${TIER_S_ADR_AMENDMENT}\n` : baseAdr, stderr: '' };
    return { exitCode: 1, stdout: '', stderr: `unexpected git command: ${args.join(' ')}` };
  });
  const runner = new DefaultStepRunner(provider, 'coverage-tier-s-amendment', projectDir, {
    featureDesc: 'tier-s',
    planPath,
    config: { coverage_binding: { judge: { enabled: options.enabled, batch_size: 8 } } },
    gitRunner,
  });
  return { projectDir, provider, prompts, runner, gitRunner };
}

describe('coverage-binding runner batches', () => {
  it('judges a branch-added tier-S ADR amendment, excludes its new decision from conflict claims, and preserves D17 not-applicable', async () => {
    const fixture = await runTierSAdrAmendment({ enabled: true, amendmentVerdict: 'not-carried' });
    try {
      const result = await fixture.runner.run('coverage_binding', { complexity_tier: 'S' });
      const envelope = parseCoverageBindingEnvelope(JSON.parse(await readFile(coverageBindingEnvelopePath(fixture.projectDir), 'utf8')));
      const amendmentPrompts = fixture.prompts.filter((prompt) => prompt.includes('DECIDE amendment'));
      const conflictPrompts = fixture.prompts.filter((prompt) => prompt.includes('conflict claim'));

      expect(result).toMatchObject({ success: false, refusal: { kind: 'needs-human' } });
      expect(result.output).toContain(TIER_S_ADR_AMENDMENT);
      expect(result.output).toContain('Missing obligation: Carry D7 in a plan task.');
      expect(amendmentPrompts).toHaveLength(1);
      expect(amendmentPrompts[0]).toContain('D7 — The branch amendment introduces this citable decision.');
      expect(conflictPrompts.join('\n')).not.toContain('D7 — The branch amendment introduces this citable decision.');
      expect(envelope).toMatchObject({
        status: 'refused',
        adrLayer: { disposition: 'not-applicable' },
        entries: expect.arrayContaining([expect.objectContaining({ kind: 'amendment', artifactPath: '.docs/decisions/adr-tier-s.md', verdict: 'not-carried' })]),
      });
      expect(envelope?.entries.some((entry) => (entry as { kind?: string; claimId?: string }).kind === 'conflict' && (entry as { claimId?: string }).claimId?.includes('adr-tier-s#D7'))).toBe(false);
      expect(fixture.gitRunner).toHaveBeenCalledWith(['merge-base', 'origin/main', 'HEAD']);
      expect(fixture.gitRunner).toHaveBeenCalledWith(['show', expect.stringMatching(/:.docs\/decisions\/adr-tier-s\.md$/)]);
    } finally {
      await rm(fixture.projectDir, { recursive: true, force: true });
    }
  });

  it('does not judge an ADR amendment already present at merge-base', async () => {
    const fixture = await runTierSAdrAmendment({ enabled: true, inherited: true });
    try {
      await expect(fixture.runner.run('coverage_binding', { complexity_tier: 'S' })).resolves.toMatchObject({ success: true });
      expect(fixture.prompts.filter((prompt) => prompt.includes('DECIDE amendment'))).toEqual([]);
      const envelope = parseCoverageBindingEnvelope(JSON.parse(await readFile(coverageBindingEnvelopePath(fixture.projectDir), 'utf8')));
      expect(envelope?.entries.filter((entry) => (entry as { kind?: string }).kind === 'amendment')).toEqual([]);
    } finally {
      await rm(fixture.projectDir, { recursive: true, force: true });
    }
  });

  it('records a tier-S branch-added ADR amendment as unjudged without dispatching the provider', async () => {
    const fixture = await runTierSAdrAmendment({ enabled: false });
    try {
      await expect(fixture.runner.run('coverage_binding', { complexity_tier: 'S' })).resolves.toMatchObject({ success: true, output: 'coverage_binding judge disabled' });
      expect(fixture.provider.invoke).not.toHaveBeenCalled();
      const envelope = parseCoverageBindingEnvelope(JSON.parse(await readFile(coverageBindingEnvelopePath(fixture.projectDir), 'utf8')));
      expect(envelope).toMatchObject({
        status: 'disabled',
        adrLayer: { disposition: 'not-applicable' },
        entries: expect.arrayContaining([expect.objectContaining({ kind: 'amendment', verdict: 'unjudged' })]),
      });
      expect(envelope?.entries.some((entry) => (entry as { kind?: string; claimId?: string }).kind === 'conflict' && (entry as { claimId?: string }).claimId?.includes('adr-tier-s#D7'))).toBe(false);
    } finally {
      await rm(fixture.projectDir, { recursive: true, force: true });
    }
  });

  it('uses the selected Pi judge native model and ladder in a Claude run', async () => {
    const piModel = 'anthropic/claude-opus-4-5';
    const piFallback = 'openai/gpt-5.6-sol';
    const provider: LLMProvider = {
      supportsSessionResume: false,
      lifecycleCapability: { synchronousSpawnPermit: true },
      invoke: vi.fn(async (options: InvokeOptions): Promise<InvokeResult> => options.model === piModel
        ? { success: false, output: `${piModel} unavailable`, exitCode: 1, modelUnavailable: true }
        : {
            success: true,
            output: JSON.stringify({ verdicts: promptClaims(options).map(({ id }) => ({ id, verdict: 'asserts' })) }),
            exitCode: 0,
          }),
    };
    const { projectDir } = await runBatches(1, 8, { provider });
    try {
      const config: HarnessConfig = {
        llm_provider: 'claude',
        defaults: { model: 'opus' },
        coverage_binding: { judge: { enabled: true, batch_size: 8 } },
        llm_providers: {
          pi: {
            model: piModel,
            model_escalation_order: [piModel],
            model_fallback_ladder: [piModel, piFallback],
          },
        },
        steps: { coverage_binding: { llm_provider: 'pi' } },
      };
      const policy = resolveProviderModelPolicy('pi', { config });
      const runner = new DefaultStepRunner(provider, 'coverage-pi-native', projectDir, {
        featureDesc: 'coverage-binding-runner',
        planPath: join(projectDir, 'plan.md'),
        config,
        providerExecution: {
          configuredProviders: ['claude'],
          runtimes: new ProviderRuntimeSet([{
            key: 'pi', provider, policy, builtIn: true,
            availability: new ModelAvailability(policy.modelFallbackLadder),
          }]),
          sessions: new ProviderSessionStore(),
        },
      });

      await expect(runner.run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({ success: true });
      const call = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as InvokeOptions;
      expect(call).toMatchObject({ model: piModel });
      expect(call.model).not.toBe('opus');
      expect((provider.invoke as ReturnType<typeof vi.fn>).mock.calls.map(([options]) => (options as InvokeOptions).model))
        .toEqual([piModel, piFallback]);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('stamps the judged HEAD so the production envelope yields a preserved judge identity', async () => {
    const { projectDir, runner } = await runBatches(2, 8);
    try {
      const git = (...args: string[]) => promisify(execFile)('git', ['-C', projectDir, ...args]);
      await git('init', '-q', '-b', 'main');
      await git('-c', 'user.email=t@example.com', '-c', 'user.name=T', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'judged');
      const head = (await git('rev-parse', 'HEAD')).stdout.trim();

      await expect(runner.run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({ success: true });

      // The envelope keeps its exact five-key contract; the stamp is a sidecar.
      const envelope = parseCoverageBindingEnvelope(JSON.parse(await readFile(coverageBindingEnvelopePath(projectDir), 'utf8')));
      expect(envelope?.status).toBe('done');
      await expect(currentPreservedJudgeIdentity(projectDir, 'coverage_binding')).resolves.toMatchObject({
        runId: envelope!.runId, attemptId: envelope!.runId, codeStamp: head,
      });
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('dispatches claim batches under short per-batch ids with no digest in the judge prompt', async () => {
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
          expect(Object.keys(claim).sort()).toEqual(['criterion', 'doneWhen', 'id', 'taskIds']);
        }
        expect(promptClaims(options).map(({ id }) => id)).toEqual(promptClaims(options).map((_, index) => `c${index + 1}`));
        expect(options.prompt).not.toContain('sha256:');
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
        return { success: true, output: JSON.stringify({ verdicts: promptClaims(options).map(({ id }) => ({ id, verdict: 'asserts' })) }), exitCode: 0 };
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
        return { success: true, output: JSON.stringify({ verdicts: promptClaims(options).map(({ id }) => ({ id, verdict: 'asserts' })) }), exitCode: 0 };
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

  it('rejects a malformed second batch without discarding accepted verdicts or dispatching later batches', async () => {
    const envelope = memoryEnvelopeFilesystem();
    const { projectDir, provider, runner } = await runBatches(20, 8, { filesystem: envelope.filesystem });
    try {
      (provider.invoke as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(async (options: InvokeOptions) => ({
          success: true,
          output: JSON.stringify({ verdicts: promptClaims(options).map(({ id }) => ({ id, verdict: 'asserts' })) }),
          exitCode: 0,
        }))
        .mockImplementationOnce(async (options: InvokeOptions) => ({
          success: true,
          output: JSON.stringify({ verdicts: promptClaims(options).slice(0, 7).map(({ id }) => ({ id, verdict: 'asserts' })) }),
          exitCode: 0,
        }));

      const result = await runner.run('coverage_binding', { complexity_tier: 'M' });
      const missingId = promptClaims((provider.invoke as ReturnType<typeof vi.fn>).mock.calls[1]![0] as InvokeOptions)[7]!.id;

      expect(result).toMatchObject({
        success: false,
        infrastructureFailure: expect.any(CoverageBindingPayloadError),
        output: expect.stringContaining(missingId),
      });
      expect((result.infrastructureFailure as Error | undefined)?.message).toContain(missingId);
      expect(result).not.toHaveProperty('refusal');
      expect(provider.invoke).toHaveBeenCalledTimes(2);
      expect(envelope.writes.at(-1)).toMatchObject({ status: 'failed' });
      expect(envelope.writes.at(-1)?.entries).toHaveLength(8);
      expect(envelope.writes.at(-1)?.entries.map(({ digest }) => digest)).toEqual(
        promptClaims((provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0]![0] as InvokeOptions).map(promptDigest),
      );
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('records accepted batches when the provider fails and does not dispatch a later batch', async () => {
    const envelope = memoryEnvelopeFilesystem();
    const { projectDir, provider, runner } = await runBatches(20, 8, { filesystem: envelope.filesystem });
    try {
      (provider.invoke as ReturnType<typeof vi.fn>)
        .mockImplementationOnce(async (options: InvokeOptions) => ({
          success: true,
          output: JSON.stringify({ verdicts: promptClaims(options).map(({ id }) => ({ id, verdict: 'asserts' })) }),
          exitCode: 0,
        }))
        .mockResolvedValueOnce({ success: false, output: 'provider unavailable', exitCode: 1 });

      const result = await runner.run('coverage_binding', { complexity_tier: 'M' });

      expect(result).toMatchObject({
        success: false,
        infrastructureFailure: expect.any(CoverageBindingPayloadError),
        output: expect.stringContaining('provider unavailable'),
      });
      expect((result.infrastructureFailure as Error | undefined)?.message).toContain('batch 2 of 3');
      expect(result.output).toContain('batch 2 of 3');
      expect(result).not.toHaveProperty('refusal');
      expect(provider.invoke).toHaveBeenCalledTimes(2);
      expect(envelope.writes.at(-1)).toMatchObject({ status: 'failed' });
      expect(envelope.writes.at(-1)?.entries).toHaveLength(8);
      expect(envelope.writes.at(-1)?.entries.map(({ digest }) => digest)).toEqual(
        promptClaims((provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0]![0] as InvokeOptions).map(promptDigest),
      );
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('retains every batch verdict and renders refused-claim details after does-not-assert', async () => {
    const envelope = memoryEnvelopeFilesystem();
    const { projectDir, provider, runner } = await runBatches(20, 8, { filesystem: envelope.filesystem });
    try {
      (provider.invoke as ReturnType<typeof vi.fn>).mockImplementation(async (options: InvokeOptions) => {
        const claims = promptClaims(options);
        const secondBatch = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls.length === 2;
        return {
          success: true,
          output: JSON.stringify({
            verdicts: claims.map(({ id }, index) =>
              secondBatch && index === 0
                ? { id, verdict: 'does-not-assert', missingAssertion: 'The check omits the criterion.' }
                : { id, verdict: 'asserts' },
            ),
          }),
          exitCode: 0,
        };
      });

      const result = await runner.run('coverage_binding', { complexity_tier: 'M' });
      const calls = (provider.invoke as ReturnType<typeof vi.fn>).mock.calls;
      const refused = promptClaims(calls[1]![0] as InvokeOptions)[0]!;

      expect(calls).toHaveLength(3);
      expect(result).toMatchObject({ success: false, refusal: { kind: 'needs-human' } });
      expect(result.output).toContain(`Criterion: ${refused.criterion}`);
      expect(result.output).toContain(`Task ids: ${refused.taskIds.join(', ')}`);
      expect(result.output).toContain(`Done when checks: ${refused.doneWhen.flat().join(' | ')}`);
      expect(result.output).toContain('Missing assertion: The check omits the criterion.');
      expect(envelope.writes.at(-1)).toMatchObject({ status: 'refused' });
      expect(envelope.writes.at(-1)?.entries).toHaveLength(20);
      expect(envelope.writes.at(-1)?.entries).toEqual(expect.arrayContaining([
        expect.objectContaining({
          digest: promptDigest(refused),
          verdict: 'does-not-assert',
          missingAssertion: 'The check omits the criterion.',
        }),
      ]));
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('resumes only the missing digests from a failed envelope', async () => {
    const envelope = memoryEnvelopeFilesystem();
    const { projectDir, provider, runner } = await runBatches(16, 8, { filesystem: envelope.filesystem });
    try {
      await writeCoverageBindingEnvelope(projectDir, {
        version: 1,
        slug: 'previous',
        runId: 'previous-run',
        status: 'failed',
        entries: Array.from({ length: 8 }, (_, index) => entryFor(index + 1)),
      }, envelope.filesystem);

      await expect(runner.run('coverage_binding', { complexity_tier: 'M' })).resolves.toMatchObject({ success: true });

      expect(provider.invoke).toHaveBeenCalledTimes(1);
      expect(promptClaims((provider.invoke as ReturnType<typeof vi.fn>).mock.calls[0]![0] as InvokeOptions).map(promptDigest)).toEqual(
        Array.from({ length: 8 }, (_, index) => entryFor(index + 9).digest),
      );
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});
