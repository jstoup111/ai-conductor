// Covers: task:13, task:14, task:15
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { InvokeOptions, InvokeResult, LLMProvider } from '../../src/execution/llm-provider.js';
import { CodexProvider } from '../../src/execution/codex-provider.js';
import { ModelAvailability } from '../../src/engine/model-availability.js';
import { CLAUDE_MODEL_POLICY, CODEX_MODEL_POLICY } from '../../src/engine/provider-model-policy.js';
import type { ProviderExecutionContext } from '../../src/engine/provider-execution.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { ProviderSetupUnavailableError } from '../../src/engine/provider-setup-failure.js';
import { PRD_AUDIT_VERDICT_PATH } from '../../src/engine/prd-audit-verdict-store.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';

const execFileAsync = promisify(execFile);
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'prd-audit-dispatch-'));
  dirs.push(root);
  const git = (...args: string[]) => execFileAsync('git', ['-C', root, ...args]);
  await execFileAsync('git', ['init', '-b', 'main', root]);
  await git('config', 'user.email', 'test@example.com'); await git('config', 'user.name', 'Test');
  await mkdir(join(root, '.docs', 'plans'), { recursive: true }); await mkdir(join(root, '.docs', 'stories'), { recursive: true });
  await writeFile(join(root, '.docs', 'plans', 'feature.md'), `# Plan\n\n**Stories:** .docs/stories/feature.md\n\n## Technical Approach\nBound the PRD audit.\n\n### Task 1: Audit\n\n**Story:** Story 1\n\n**Done when:**\n- the audit dispatches typed evidence\n`);
  await writeFile(join(root, '.docs', 'stories', 'feature.md'), `# Stories\n\n## Story 1: Audit\n\n### Happy Path\n- Given an active feature, when audited, then the evidence is bounded.\n`);
  await writeFile(join(root, 'tracked.ts'), 'export const value = 1;\n'); await git('add', '.'); await git('commit', '-m', 'base');
  await git('checkout', '-b', 'feature/audit'); await writeFile(join(root, 'tracked.ts'), 'export const value = 2;\n'); await git('add', '.'); await git('commit', '-m', 'change');
  return root;
}

function runner(
  root: string,
  result: InvokeResult,
  native = true,
  providerExecution?: Pick<ProviderExecutionContext, 'prepareCandidateSelfHost'>,
) {
  const invoke = vi.fn(async (_: InvokeOptions) => result);
  const provider = { name: 'claude', invoke } as unknown as LLMProvider;
  const sessionStore = new ProviderSessionStore();
  const runtimes = new ProviderRuntimeSet([{
    key: 'claude', provider, lifecycleCapability: { synchronousSpawnPermit: true },
    ...(native ? { nativeSchemaCapability: { nativeOutputSchema: true as const } } : {}),
    policy: CLAUDE_MODEL_POLICY, builtIn: true,
    availability: new ModelAvailability(CLAUDE_MODEL_POLICY.modelFallbackLadder),
  }]);
  return { invoke, runner: new DefaultStepRunner({ invoke: vi.fn() }, 'prd-attempt', root, {
    mode: 'auto', featureDesc: 'feature',
    config: { llm_provider: 'claude', steps: { prd_audit: { llm_provider: 'claude' } } },
    configuredProviders: ['claude'], providerRuntimes: runtimes, sessionStore,
    ...(providerExecution === undefined ? {} : {
      providerExecution: { configuredProviders: ['claude'], runtimes, sessions: sessionStore, ...providerExecution },
    }),
  }) };
}

function codexRunner(root: string, provider: LLMProvider) {
  const runtimes = new ProviderRuntimeSet([{
    key: 'codex', provider, lifecycleCapability: { synchronousSpawnPermit: true },
    nativeSchemaCapability: { nativeOutputSchema: true as const },
    policy: CODEX_MODEL_POLICY, builtIn: true,
    availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
  }]);
  return new DefaultStepRunner({ invoke: vi.fn() }, 'prd-timeout', root, {
    mode: 'auto', featureDesc: 'feature',
    config: { llm_provider: 'codex', steps: { prd_audit: { llm_provider: 'codex' } } },
    configuredProviders: ['codex'], providerRuntimes: runtimes, sessionStore: new ProviderSessionStore(),
  });
}

const structuredLookingJudgment = {
  version: 'v1',
  criterionJudgments: [{
    criterion: { storyId: '1', ordinal: 1 }, grade: 'PASS', evidence: 'Stale.', rationale: 'Must not persist.',
    requirementAssociations: [], evidenceTaskIds: ['1'],
  }],
  noOwnerObservations: [],
};

async function expectNoVerdict(root: string): Promise<void> {
  await expect(access(join(root, PRD_AUDIT_VERDICT_PATH))).rejects.toMatchObject({ code: 'ENOENT' });
}

describe('PRD audit typed provider dispatch', () => {
  it('sends engine-owned bounded evidence and persists only a validated terminal judgment', async () => {
    const root = await fixture();
    const { invoke, runner: subject } = runner(root, { success: true, output: 'done', finalStructuredResult: { version: 'v1', criterionJudgments: [{ criterion: { storyId: '1', ordinal: 1 }, grade: 'PASS', evidence: 'Covered.', rationale: 'The changed path is covered.', requirementAssociations: [], evidenceTaskIds: ['1'] }], noOwnerObservations: [] } } as InvokeResult);
    await expect(subject.run('prd_audit', { complexity_tier: 'S' })).resolves.toMatchObject({ success: true });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]![0].interactive).toBe(false);
    expect(invoke.mock.calls[0]![0].nativeSchema).toBeDefined();
    expect(invoke.mock.calls[0]![0].prompt).toContain('PRD-AUDIT EVIDENCE');
    expect(JSON.parse(await readFile(join(root, PRD_AUDIT_VERDICT_PATH), 'utf8'))).toMatchObject({ attemptId: 'prd-attempt', complete: true });
  });

  it('refuses a candidate lacking native structured output before invocation', async () => {
    const root = await fixture();
    const { invoke, runner: subject } = runner(root, { success: true, output: 'unreachable' } as InvokeResult, false);
    await expect(subject.run('prd_audit', { complexity_tier: 'S' })).resolves.toMatchObject({ success: false, prdAuditFault: { kind: 'capability' } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('reports a missing authoritative plan as an unretryable projection fault before invocation', async () => {
    const root = await fixture();
    await rm(join(root, '.docs', 'plans', 'feature.md'));
    const { invoke, runner: subject } = runner(root, { success: true, output: 'unreachable' } as InvokeResult);
    await expect(subject.run('prd_audit', { complexity_tier: 'S' })).resolves.toMatchObject({
      success: false, prdAuditFault: { kind: 'input', reason: expect.stringContaining('plan') },
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    ['authentication', { success: false, output: 'authentication required', exitCode: 1, authFailure: true, finalStructuredResult: structuredLookingJudgment }, { authFailure: true, output: 'authentication required' }],
    ['rate limit', { success: false, output: 'retry after 17 seconds', exitCode: 429, rateLimited: true, waitSeconds: 17, finalStructuredResult: structuredLookingJudgment }, { rateLimited: true, waitSeconds: 17, output: 'retry after 17 seconds' }],
    ['unavailable model', { success: false, output: 'model unavailable', exitCode: 1, modelUnavailable: true, finalStructuredResult: structuredLookingJudgment }, { output: expect.stringContaining('All configured providers are unavailable') }],
    ['unresolved skill', { success: false, output: 'skill prd-audit is not installed', exitCode: 127, commandUnresolved: true, commandUnresolvedName: 'prd-audit', finalStructuredResult: structuredLookingJudgment }, { commandUnresolved: true, commandUnresolvedName: 'prd-audit', output: 'skill prd-audit is not installed' }],
  ] as const)('preserves a %s failure instead of relabeling it as missing judgment', async (_name, result, expected) => {
    const root = await fixture();
    const { runner: subject } = runner(root, result);
    await expect(subject.run('prd_audit', { complexity_tier: 'S' })).resolves.toMatchObject({ success: false, ...expected });
    await expectNoVerdict(root);
  });

  it('returns typed setup exhaustion without an invocation or accepted audit', async () => {
    const root = await fixture();
    const prepareCandidateSelfHost = vi.fn(async () => {
      throw new ProviderSetupUnavailableError({
        provider: 'claude', capability: 'native-schema', reason: 'isolated provider setup is unavailable',
        recoveryAction: 'restore isolated provider setup and retry',
      });
    });
    const { invoke, runner: subject } = runner(root, { success: true, output: 'unreachable', exitCode: 0 }, true, { prepareCandidateSelfHost });

    await expect(subject.run('prd_audit', { complexity_tier: 'S' })).resolves.toMatchObject({
      success: false,
      providerSetupExhaustion: { candidates: [{ provider: 'claude', capability: 'native-schema' }] },
    });
    expect(prepareCandidateSelfHost).toHaveBeenCalledOnce();
    expect(invoke).not.toHaveBeenCalled();
    await expectNoVerdict(root);
    await expect(access(join(root, '.daemon', 'scratch'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('discards a timed-out Codex audit and releases its native-schema scratch file', async () => {
    const root = await fixture();
    let schemaPath: string | undefined;
    const subprocess = vi.fn(async (_file: string, args: readonly string[]) => {
      const index = args.indexOf('--output-schema');
      schemaPath = index === -1 ? undefined : args[index + 1];
      await access(schemaPath!);
      return { stdout: '', stderr: 'request timed out', exitCode: 1 };
    });
    const adapter = new CodexProvider(
      async () => ({ stdout: JSON.stringify({ schemaVersion: 1, auth: { selectedMode: 'cached-login', configured: true }, transport: { authenticated: true } }), exitCode: 0 }),
      'codex', undefined, subprocess as never,
    );
    const invoke = vi.fn(adapter.invoke.bind(adapter));
    const subject = codexRunner(root, { ...adapter, invoke });

    await expect(subject.run('prd_audit', { complexity_tier: 'S' })).resolves.toMatchObject({
      success: false,
      output: expect.stringContaining('timed out'),
    });
    expect(invoke).toHaveBeenCalledOnce();
    expect(schemaPath).toBeDefined();
    await expect(access(schemaPath!)).rejects.toMatchObject({ code: 'ENOENT' });
    await expectNoVerdict(root);
  });
});
