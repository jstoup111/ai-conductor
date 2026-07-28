import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { SessionManager } from '../../src/execution/session.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { ConductState } from '../../src/types/index.js';

describe('ProviderSessionStore', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it('mints and mirrors a fresh session id for every provider invocation', async () => {
    const pipelineDir = await mkdtemp(join(tmpdir(), 'provider-invocation-session-'));
    tempDirs.push(pipelineDir);
    const legacySession = new SessionManager(pipelineDir);
    const ids = ['claude-invocation-1', 'claude-invocation-2'];
    const store = new ProviderSessionStore({
      createSessionId: () => ids.shift()!,
      legacy: { providerKey: 'claude', session: legacySession },
    });
    await store.beginStep('build');

    const first = await store.prepare('claude');
    const second = await store.prepare('claude');

    expect({
      first,
      second,
      current: store.current('claude'),
      legacyId: await legacySession.getSessionId(),
      legacyCreated: await legacySession.isSessionCreated(),
    }).toEqual({
      first: { id: 'claude-invocation-1', resume: false },
      second: { id: 'claude-invocation-2', resume: false },
      current: { id: 'claude-invocation-2' },
      legacyId: 'claude-invocation-2',
      legacyCreated: false,
    });
  });

  it('isolates providers within one execution and invalidates them at every later step boundary', async () => {
    const pipelineDir = await mkdtemp(join(tmpdir(), 'provider-session-'));
    tempDirs.push(pipelineDir);
    const legacySession = new SessionManager(pipelineDir);
    await legacySession.getSessionId();
    await legacySession.markSessionCreated();

    const ids = ['build-claude', 'build-codex', 'review-claude'];
    const store = new ProviderSessionStore({
      createSessionId: () => ids.shift()!,
      legacy: { providerKey: 'claude', session: legacySession },
    });

    await store.beginStep('build');
    const seededLegacyImported = store.current('claude');
    const seededLegacyCreatedAfterBoundary = await legacySession.isSessionCreated();
    const buildClaude = { ...(await store.create('claude')) };
    const buildCodex = { ...(await store.create('codex')) };
    const activeClaude = store.current('claude');
    const activeCodex = store.current('codex');
    const activeBuildSessions = {
      claude: activeClaude ? { ...activeClaude } : undefined,
      codex: activeCodex ? { ...activeCodex } : undefined,
      legacyId: await legacySession.getSessionId(),
      legacyCreated: await legacySession.isSessionCreated(),
    };

    // The label deliberately repeats: the beginStep call is the execution
    // boundary. A repeated step name must not regain the prior scope.
    await store.beginStep('build');
    const priorSessionsAfterBoundary = {
      claude: store.current('claude'),
      codex: store.current('codex'),
      legacyCreated: await legacySession.isSessionCreated(),
    };
    const reviewClaude = { ...(await store.create('claude')) };

    expect({
      seededLegacyImported,
      seededLegacyCreatedAfterBoundary,
      buildClaude,
      buildCodex,
      activeBuildSessions,
      priorSessionsAfterBoundary,
      reviewClaude,
      buildClaudeStillCurrent: store.current('claude')?.id === buildClaude.id,
      codexStillCurrent: store.current('codex') !== undefined,
      legacyId: await legacySession.getSessionId(),
      legacyCreated: await legacySession.isSessionCreated(),
    }).toEqual({
      seededLegacyImported: undefined,
      seededLegacyCreatedAfterBoundary: false,
      buildClaude: { id: 'build-claude' },
      buildCodex: { id: 'build-codex' },
      activeBuildSessions: {
        claude: { id: 'build-claude' },
        codex: { id: 'build-codex' },
        legacyId: 'build-claude',
        legacyCreated: false,
      },
      priorSessionsAfterBoundary: {
        claude: undefined,
        codex: undefined,
        legacyCreated: false,
      },
      reviewClaude: { id: 'review-claude' },
      buildClaudeStillCurrent: false,
      codexStillCurrent: false,
      legacyId: 'review-claude',
      legacyCreated: false,
    });
  });

  it('cold-starts every invocation while provider switches, later steps, and concurrent branches stay isolated', async () => {
    const pipelineDir = await mkdtemp(join(tmpdir(), 'provider-retry-session-'));
    tempDirs.push(pipelineDir);
    const legacySession = new SessionManager(pipelineDir);
    await legacySession.getSessionId();
    await legacySession.markSessionCreated();

    const ids = [
      'step-claude-1',
      'step-claude-2',
      'step-codex-1',
      'replacement-claude',
      'replacement-claude-retry',
      'step-codex-2',
      'next-step-claude',
      'ab-a-1',
      'ab-b-1',
      'ab-a-2',
      'ab-b-2',
      'ba-a-1',
      'ba-b-1',
      'ba-a-2',
      'ba-b-2',
    ];
    const store = new ProviderSessionStore({
      createSessionId: () => ids.shift()!,
      legacy: { providerKey: 'claude', session: legacySession },
    });

    await store.beginStep('build');
    const firstClaude = await store.prepare('claude');
    const retryClaude = await store.prepare('claude');
    const switchedCodex = await store.prepare('codex');
    const replacementClaude = await store.replace('claude');
    const retryAfterReplacement = await store.prepare('claude');
    const codexAfterClaudeReplacement = await store.prepare('codex');

    // A repeated label is still a distinct step execution.
    await store.beginStep('build');
    const nextStepClaude = await store.prepare('claude');

    const branchAB_A = store.beginBranch('manual_test');
    const branchAB_B = store.beginBranch('prd_audit');
    const branchAB_AFirst = await branchAB_A.prepare('claude');
    const branchAB_BFirst = await branchAB_B.prepare('claude');
    const branchAB_ARetry = await branchAB_A.prepare('claude');
    const branchAB_BRetry = await branchAB_B.prepare('claude');

    const branchBA_A = store.beginBranch('manual_test');
    const branchBA_B = store.beginBranch('prd_audit');
    const branchBA_AFirst = await branchBA_A.prepare('claude');
    const branchBA_BFirst = await branchBA_B.prepare('claude');
    const branchBA_ARetry = await branchBA_A.prepare('claude');
    const branchBA_BRetry = await branchBA_B.prepare('claude');

    expect({
      firstClaude,
      retryClaude,
      switchedCodex,
      replacementClaude,
      retryAfterReplacement,
      codexAfterClaudeReplacement,
      nextStepClaude,
      branchAB: {
        aFirst: branchAB_AFirst,
        bFirst: branchAB_BFirst,
        aRetry: branchAB_ARetry,
        bRetry: branchAB_BRetry,
      },
      branchBA: {
        aFirst: branchBA_AFirst,
        bFirst: branchBA_BFirst,
        aRetry: branchBA_ARetry,
        bRetry: branchBA_BRetry,
      },
      serialScopeAfterBranches: store.current('claude'),
      legacyAfterBranches: {
        id: await legacySession.getSessionId(),
        created: await legacySession.isSessionCreated(),
      },
    }).toEqual({
      firstClaude: { id: 'step-claude-1', resume: false },
      retryClaude: { id: 'step-claude-2', resume: false },
      switchedCodex: { id: 'step-codex-1', resume: false },
      replacementClaude: { id: 'replacement-claude', resume: false },
      retryAfterReplacement: { id: 'replacement-claude-retry', resume: false },
      codexAfterClaudeReplacement: { id: 'step-codex-2', resume: false },
      nextStepClaude: { id: 'next-step-claude', resume: false },
      branchAB: {
        aFirst: { id: 'ab-a-1', resume: false },
        bFirst: { id: 'ab-b-1', resume: false },
        aRetry: { id: 'ab-a-2', resume: false },
        bRetry: { id: 'ab-b-2', resume: false },
      },
      branchBA: {
        aFirst: { id: 'ba-a-1', resume: false },
        bFirst: { id: 'ba-b-1', resume: false },
        aRetry: { id: 'ba-a-2', resume: false },
        bRetry: { id: 'ba-b-2', resume: false },
      },
      serialScopeAfterBranches: { id: 'next-step-claude' },
      legacyAfterBranches: { id: 'next-step-claude', created: false },
    });
  });

  it('does not let successful or failed interactive branches mutate the serial provider session', async () => {
    const observations = [];

    for (const outcome of ['success', 'throw'] as const) {
      const pipelineDir = await mkdtemp(join(tmpdir(), `provider-branch-${outcome}-`));
      tempDirs.push(pipelineDir);
      const legacySession = new SessionManager(pipelineDir);
      const store = new ProviderSessionStore({
        createSessionId: () => `serial-${outcome}`,
        legacy: { providerKey: 'claude', session: legacySession },
      });
      await store.beginStep('build');
      const serial = await store.prepare('claude');

      const calls: Array<{ sessionId: string; resume: boolean }> = [];
      const provider: LLMProvider = {
        invoke: async () => ({ success: true, output: '', exitCode: 0 }),
        invokeInteractive: async (options) => {
          calls.push({
            sessionId: options.sessionId,
            resume: options.resume,
          });
          if (outcome === 'throw') throw new Error('branch failed');
        },
      };
      const runner = new DefaultStepRunner(provider, serial.id, pipelineDir, {
        pipelineDir,
        sessionStore: store,
        providerKey: 'claude',
      });

      const result = await runner.run('manual_test', {} as ConductState, {
        sessionId: `branch-${outcome}`,
        resume: false,
      });

      observations.push({
        outcome,
        calls,
        result,
        serial: store.current('claude'),
        legacyId: await legacySession.getSessionId(),
        legacyCreated: await legacySession.isSessionCreated(),
      });
    }

    expect(observations).toEqual([
      {
        outcome: 'success',
        calls: [{ sessionId: 'branch-success', resume: false }],
        result: { success: true },
        serial: { id: 'serial-success' },
        legacyId: 'serial-success',
        legacyCreated: false,
      },
      {
        outcome: 'throw',
        calls: [{ sessionId: 'branch-throw', resume: false }],
        result: {
          success: false,
          output: 'Session for manual_test exited with error: branch failed',
        },
        serial: { id: 'serial-throw' },
        legacyId: 'serial-throw',
        legacyCreated: false,
      },
    ]);
  });
});
