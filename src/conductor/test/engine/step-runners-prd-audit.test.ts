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
import type { GitRunner } from '../../src/engine/rebase.js';
import type { ProviderExecutionContext } from '../../src/engine/provider-execution.js';
import { ProviderRuntimeSet } from '../../src/engine/provider-runtime.js';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { ProviderSetupUnavailableError } from '../../src/engine/provider-setup-failure.js';
import { PRD_AUDIT_JUDGMENT_SCHEMA } from '../../src/engine/prd-audit-contract.js';
import { PRD_AUDIT_REPORT_PATH, PRD_AUDIT_VERDICT_PATH } from '../../src/engine/prd-audit-verdict-store.js';
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
  await mkdir(join(root, '.docs', 'plans'), { recursive: true }); await mkdir(join(root, '.docs', 'stories'), { recursive: true }); await mkdir(join(root, '.docs', 'specs'), { recursive: true }); await mkdir(join(root, '.docs', 'coherence'), { recursive: true }); await mkdir(join(root, '.pipeline'), { recursive: true });
  await writeFile(join(root, '.docs', 'plans', 'feature.md'), `# Plan\n\n**Stories:** .docs/stories/feature.md\n\n## Technical Approach\nBound the PRD audit.\n\n### Task 1: Project criteria\n\n**Story:** Story 1\n\n**Done when:**\n- the audit dispatches typed evidence\n\n### Task 2: Persist verdict\n\n**Story:** Story 1\n\n**Done when:**\n- the rendered report reflects the persisted judgment\n`);
  await writeFile(join(root, '.docs', 'stories', 'feature.md'), `# Stories\n\n## Story 1: Audit\n\n**Requirements:** FR-1\n\n### Happy Path\n- Given an active feature, when audited, then the evidence is bounded.\n\n### Negative Paths\n- Given a malformed judgment, when audited, then the engine rejects it.\n`);
  await writeFile(join(root, '.docs', 'specs', 'feature.md'), `# PRD\n\n## Goals\n- Keep the audit bounded.\n\n## Non-Goals\n- Do not broaden review authority.\n\n## In Scope\n- Typed PRD evidence.\n\n## Out of Scope\n- Legacy Markdown parsing.\n\n## Functional Requirements\n- FR-1: The audit uses typed evidence.\n`);
  await writeFile(join(root, '.docs', 'coherence', 'feature.md'), `# Coherence\n\n| Row Class | Id | Cited Ids | Verdict | Quote |\n| --- | --- | --- | --- | --- |\n| fr | FR-1 | story-1 | covered | The audit uses typed evidence. |\n| story | story-1 | 1, 2 | covered | Audit ownership remains attributable. |\n`);
  await writeFile(join(root, '.pipeline', 'accepted-widenings.json'), JSON.stringify({
    version: 2,
    feature: { version: 1, repository: 'fixture-repository', feature: 'feature' },
    decisions: [{
      id: 'decision-1', criterion: 'NC-1', authority: 'accept', rationale: 'Keep the recorded decision.',
      operator: 'operator@example.test', revision: 1,
      originalSource: { id: 'prd-audit:NC-1', snapshot: 'Original attributable finding.' }, originalCaseId: 'case-1',
    }],
  }));
  await writeFile(join(root, '.pipeline', 'engine-state.json'), JSON.stringify({
    feature_desc: 'feature', activePlanPath: '.docs/plans/feature.md',
  }));
  await writeFile(join(root, 'tracked.ts'), 'export const value = 1;\n'); await git('add', '.'); await git('commit', '-m', 'base');
  await git('checkout', '-b', 'feature/audit'); await writeFile(join(root, 'tracked.ts'), 'export const value = 2;\n'); await git('add', '.'); await git('commit', '-m', 'change');
  return root;
}

function runner(
  root: string,
  result: InvokeResult,
  native = true,
  providerExecution?: Pick<ProviderExecutionContext, 'prepareCandidateSelfHost'>,
  mode: 'auto' | 'interactive' = 'auto',
  gitRunner?: GitRunner,
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
    mode, featureDesc: 'feature',
    config: { llm_provider: 'claude', steps: { prd_audit: { llm_provider: 'claude' } } },
    configuredProviders: ['claude'], providerRuntimes: runtimes, sessionStore,
    ...(gitRunner === undefined ? {} : { gitRunner }),
    ...(providerExecution === undefined ? {} : {
      providerExecution: { configuredProviders: ['claude'], runtimes, sessions: sessionStore, ...providerExecution },
    }),
  }) };
}

function codexRunner(root: string, provider: LLMProvider, mode: 'auto' | 'interactive' = 'auto') {
  const runtimes = new ProviderRuntimeSet([{
    key: 'codex', provider, lifecycleCapability: { synchronousSpawnPermit: true },
    nativeSchemaCapability: { nativeOutputSchema: true as const },
    policy: CODEX_MODEL_POLICY, builtIn: true,
    availability: new ModelAvailability(CODEX_MODEL_POLICY.modelFallbackLadder),
  }]);
  return new DefaultStepRunner({ invoke: vi.fn() }, 'prd-timeout', root, {
    mode, featureDesc: 'feature',
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

function dispatchedProjection(invoke: ReturnType<typeof vi.fn>) {
  const prompt = invoke.mock.calls[0]![0].prompt;
  const prefix = 'PRD-AUDIT EVIDENCE (engine-owned, versioned):\n';
  const suffix = '\n\nTerminal judgment shape (engine-owned):';
  const start = prompt.indexOf(prefix);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = prompt.indexOf(suffix, start);
  expect(end).toBeGreaterThan(start + prefix.length);
  return JSON.parse(prompt.slice(start + prefix.length, end)) as {
    version: number;
    plan: { intent: string };
    criteria: { id: string; kind: string; requirementAssociations: { path: string; requirementId: string }[] }[];
    tasks: { id: string; storyIds: string[]; doneWhen: string[] }[];
    prd: { sources: Array<{ path: string; requirements: unknown; intent: unknown }> };
    coherence: unknown;
    changes: { changedFiles: unknown[]; base: string; head: string };
    history: unknown;
  };
}

const passingJudgment = {
  version: 'v1',
  criterionJudgments: [
    { criterion: { storyId: '1', ordinal: 1 }, grade: 'PASS', evidence: 'Happy path is covered.', rationale: 'The change covers bounded evidence.', requirementAssociations: [], evidenceTaskIds: ['1'] },
    { criterion: { storyId: '1', ordinal: 2 }, grade: 'PASS', evidence: 'Negative path is covered.', rationale: 'The change rejects malformed judgments.', requirementAssociations: [], evidenceTaskIds: ['2'] },
  ],
  noOwnerObservations: [],
};

describe('PRD audit typed provider dispatch', () => {
  it('projects each fixture criterion and task, then renders its validated terminal judgment', async () => {
    const root = await fixture();
    const { invoke, runner: subject } = runner(root, { success: true, output: 'done', finalStructuredResult: passingJudgment } as InvokeResult);
    await expect(subject.run('prd_audit', { complexity_tier: 'S' })).resolves.toMatchObject({ success: true });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls[0]![0].interactive).toBe(false);
    expect(invoke.mock.calls[0]![0].nativeSchema).toBe(PRD_AUDIT_JUDGMENT_SCHEMA);
    expect(dispatchedProjection(invoke)).toMatchObject({
      version: 4,
      plan: { intent: 'Bound the PRD audit.' },
      criteria: [
        { id: 'S1.1', kind: 'happy', requirementAssociations: [{ path: '.docs/specs/feature.md', requirementId: 'FR-1' }] },
        { id: 'S1.2', kind: 'negative', requirementAssociations: [{ path: '.docs/specs/feature.md', requirementId: 'FR-1' }] },
      ],
      tasks: [
        { id: '1', storyIds: ['1'], doneWhen: ['the audit dispatches typed evidence'] },
        { id: '2', storyIds: ['1'], doneWhen: ['the rendered report reflects the persisted judgment'] },
      ],
      prd: { sources: [expect.objectContaining({
        path: '.docs/specs/feature.md',
        requirements: [{ id: 'FR-1', text: 'The audit uses typed evidence.' }],
        intent: {
          goals: { kind: 'present', text: '- Keep the audit bounded.' },
          nonGoals: { kind: 'present', text: '- Do not broaden review authority.' },
          inScope: { kind: 'present', text: '- Typed PRD evidence.' },
          outOfScope: { kind: 'present', text: '- Legacy Markdown parsing.' },
        },
      })] },
      coherence: [
        { rowClass: 'fr', id: 'FR-1', citedIds: ['story-1'] },
        { rowClass: 'story', id: 'story-1', citedIds: ['1', '2'] },
      ],
      changes: { changedFiles: [expect.objectContaining({ path: 'tracked.ts', additions: 1, deletions: 1 })] },
      history: { decisions: [expect.objectContaining({ id: 'decision-1', criterion: 'NC-1', authority: 'accept' })], cases: [] },
    });
    const persisted = JSON.parse(await readFile(join(root, PRD_AUDIT_VERDICT_PATH), 'utf8'));
    expect(persisted).toMatchObject({ attemptId: 'prd-attempt', complete: true, judgment: passingJudgment });
    await expect(readFile(join(root, PRD_AUDIT_REPORT_PATH), 'utf8')).resolves.toContain('S1.2: PASS — Negative path is covered.');
  });

  it('gives Claude and Codex the same complete projection and native contract, then settles equal judgments equivalently', async () => {
    const root = await fixture();
    const claude = runner(root, { success: true, output: 'done', finalStructuredResult: passingJudgment } as InvokeResult);
    const codexInvoke = vi.fn(async (_options: InvokeOptions) => ({ success: true, output: 'done', finalStructuredResult: passingJudgment } as InvokeResult));
    const codex = codexRunner(root, { name: 'codex', invoke: codexInvoke } as unknown as LLMProvider);

    await expect(claude.runner.run('prd_audit', { complexity_tier: 'S' })).resolves.toMatchObject({ success: true });
    const claudeVerdict = JSON.parse(await readFile(join(root, PRD_AUDIT_VERDICT_PATH), 'utf8'));
    await expect(codex.run('prd_audit', { complexity_tier: 'S' })).resolves.toMatchObject({ success: true });
    const codexVerdict = JSON.parse(await readFile(join(root, PRD_AUDIT_VERDICT_PATH), 'utf8'));

    expect(claude.invoke.mock.calls[0]![0]).toMatchObject({ interactive: false, nativeSchema: PRD_AUDIT_JUDGMENT_SCHEMA });
    expect(codexInvoke.mock.calls[0]![0]).toMatchObject({ interactive: false, nativeSchema: PRD_AUDIT_JUDGMENT_SCHEMA });
    expect(dispatchedProjection(codexInvoke)).toEqual(dispatchedProjection(claude.invoke));
    const { attemptId: _claudeAttempt, ...claudeComparable } = claudeVerdict;
    const { attemptId: _codexAttempt, ...codexComparable } = codexVerdict;
    expect(codexComparable).toEqual(claudeComparable);
  });

  it.each(['auto', 'interactive'] as const)('uses a fresh non-interactive one-shot in %s managed mode', async (mode) => {
    const root = await fixture();
    const { invoke, runner: subject } = runner(root, { success: true, output: 'done', finalStructuredResult: passingJudgment } as InvokeResult, true, undefined, mode);

    await expect(subject.run('prd_audit', { complexity_tier: 'S' })).resolves.toMatchObject({ success: true });
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke.mock.calls[0]![0]).toMatchObject({ interactive: false, resume: false, nativeSchema: PRD_AUDIT_JUDGMENT_SCHEMA });
  });

  it('persists a partial verdict with diagnostics when validation rejects an invented criterion', async () => {
    const root = await fixture();
    const { runner: subject } = runner(root, {
      success: true,
      output: 'done',
      finalStructuredResult: {
        ...passingJudgment,
        criterionJudgments: [
          passingJudgment.criterionJudgments[0],
          { criterion: { storyId: '999', ordinal: 1 }, grade: 'PASS', evidence: 'Invented.', rationale: 'This criterion does not exist.', requirementAssociations: [], evidenceTaskIds: ['2'] },
        ],
      },
    } as InvokeResult);

    await expect(subject.run('prd_audit', { complexity_tier: 'S' })).resolves.toMatchObject({
      success: false,
      output: expect.stringContaining('structured-result-rejected'),
    });

    const persisted = JSON.parse(await readFile(join(root, PRD_AUDIT_VERDICT_PATH), 'utf8'));
    expect(persisted).toMatchObject({
      attemptId: 'prd-attempt',
      complete: false,
      diagnostics: expect.arrayContaining(['criterionJudgments[1].criterion does not resolve active criterion S999.1']),
      judgment: { criterionJudgments: [expect.objectContaining({ criterionId: 'S1.1' })] },
    });
    expect(persisted.judgment.criterionJudgments).not.toContainEqual(expect.objectContaining({ criterionId: 'S999.1' }));
  });

  it('fails before persistence when the reviewed code stamp is unavailable', async () => {
    const root = await fixture();
    const unavailableHead: GitRunner = async () => ({ stdout: '', stderr: 'not a git worktree', exitCode: 128 });
    const { runner: subject } = runner(
      root,
      { success: true, output: 'done', finalStructuredResult: passingJudgment } as InvokeResult,
      true,
      undefined,
      'auto',
      unavailableHead,
    );

    await expect(subject.run('prd_audit', { complexity_tier: 'S' })).resolves.toMatchObject({
      success: false,
      output: expect.stringContaining('reviewed code stamp unavailable'),
    });
    await expectNoVerdict(root);
  });

  it.each([
    ['no terminal structured result', { success: true, output: 'done' }],
    ['a malformed terminal structured result', { success: true, output: 'done', finalStructuredResult: { malformed: true } }],
  ])('does not succeed or persist a verdict for %s', async (_name, result) => {
    const root = await fixture();
    const { runner: subject } = runner(root, result as InvokeResult);

    await expect(subject.run('prd_audit', { complexity_tier: 'S' })).resolves.toMatchObject({ success: false });
    await expectNoVerdict(root);
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
    ['unresolved active plan despite a valid foreign replacement', async (root: string) => {
      await rm(join(root, '.docs', 'plans', 'feature.md'));
      await writeFile(join(root, '.docs', 'plans', 'foreign.md'), '# Plan\n\n## Technical Approach\nForeign plan.\n');
    }, 'plan'],
    ['unreadable sealed stories despite a valid foreign replacement', async (root: string) => {
      await rm(join(root, '.docs', 'stories', 'feature.md'));
      await writeFile(join(root, '.docs', 'stories', 'foreign.md'), '# Stories\n\n## Story foreign: Foreign\n\n### Happy Path\n- Given foreign input, when audited, then it passes.\n\n### Negative Paths\n- Given foreign input, when rejected, then it is reported.\n');
    }, 'stories'],
    ['a required PRD despite a valid foreign replacement', async (root: string) => {
      await rm(join(root, '.docs', 'specs', 'feature.md'));
      await writeFile(join(root, '.docs', 'specs', 'foreign.md'), '# PRD\n\n## Functional Requirements\n- FR-99: Foreign requirement.\n');
    }, 'prd'],
    ['unparseable criteria', async (root: string) => {
      await writeFile(join(root, '.docs', 'stories', 'feature.md'), '# Stories\n\n## Story 1: Broken\n\n### Happy Path\n- Given input, when audited, it passes.\n\n### Negative Paths\n- Given input, when rejected, then it is reported.\n');
    }, 'malformed-criteria'],
    ['unparseable task completion conditions', async (root: string) => {
      const planPath = join(root, '.docs', 'plans', 'feature.md');
      const plan = await readFile(planPath, 'utf8');
      await writeFile(planPath, plan.replace('- the audit dispatches typed evidence', ''));
    }, 'plan task completion conditions'],
    ['foreign attributable history', async (root: string) => {
      const historyPath = join(root, '.pipeline', 'accepted-widenings.json');
      const history = JSON.parse(await readFile(historyPath, 'utf8'));
      history.feature.feature = 'foreign';
      await writeFile(historyPath, JSON.stringify(history));
    }, 'history'],
  ] as const)('stops before invocation for %s and names the affected source dimension', async (_name, arrange, dimension) => {
    const root = await fixture();
    await arrange(root);
    const { invoke, runner: subject } = runner(root, { success: true, output: 'unreachable' } as InvokeResult);

    await expect(subject.run('prd_audit', { complexity_tier: 'S' })).resolves.toMatchObject({
      success: false,
      output: expect.stringContaining(dimension),
      prdAuditFault: { kind: 'input', reason: expect.stringContaining(dimension) },
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('stops before invocation when the complete structured plan input exceeds its engineering limit', async () => {
    const root = await fixture();
    const planPath = join(root, '.docs', 'plans', 'feature.md');
    const plan = await readFile(planPath, 'utf8');
    await writeFile(planPath, plan.replace('Bound the PRD audit.', 'x'.repeat((256 * 1024) + 1)));
    const { invoke, runner: subject } = runner(root, { success: true, output: 'unreachable' } as InvokeResult);

    await expect(subject.run('prd_audit', { complexity_tier: 'S' })).resolves.toMatchObject({
      success: false,
      output: expect.stringMatching(/plan-intent \(actual \d+, limit \d+\)/),
      prdAuditFault: { kind: 'input', reason: expect.stringMatching(/plan-intent \(actual \d+, limit \d+\)/) },
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
    expect(dispatchedProjection(invoke).prd.sources[0]).toMatchObject({
      intent: {
        goals: { kind: 'present', text: '- Keep the audit bounded.' },
        nonGoals: { kind: 'present', text: '- Do not broaden review authority.' },
        inScope: { kind: 'present', text: '- Typed PRD evidence.' },
        outOfScope: { kind: 'present', text: '- Legacy Markdown parsing.' },
      },
    });
    expect(schemaPath).toBeDefined();
    await expect(access(schemaPath!)).rejects.toMatchObject({ code: 'ENOENT' });
    await expectNoVerdict(root);
  });
});
