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
    await store.markCreated('claude');
    const buildCodex = { ...(await store.create('codex')) };
    await store.markCreated('codex');
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
      reviewClaudeCreated: store.current('claude')?.created,
      legacyId: await legacySession.getSessionId(),
      legacyCreated: await legacySession.isSessionCreated(),
    }).toEqual({
      seededLegacyImported: undefined,
      seededLegacyCreatedAfterBoundary: false,
      buildClaude: { id: 'build-claude', created: false },
      buildCodex: { id: 'build-codex', created: false },
      activeBuildSessions: {
        claude: { id: 'build-claude', created: true },
        codex: { id: 'build-codex', created: true },
        legacyId: 'build-claude',
        legacyCreated: true,
      },
      priorSessionsAfterBoundary: {
        claude: undefined,
        codex: undefined,
        legacyCreated: false,
      },
      reviewClaude: { id: 'review-claude', created: false },
      buildClaudeStillCurrent: false,
      codexStillCurrent: false,
      reviewClaudeCreated: false,
      legacyId: 'review-claude',
      legacyCreated: false,
    });
  });

  it('resumes only matching retries while stale resets, provider switches, later steps, and concurrent branches stay isolated', async () => {
    const pipelineDir = await mkdtemp(join(tmpdir(), 'provider-retry-session-'));
    tempDirs.push(pipelineDir);
    const legacySession = new SessionManager(pipelineDir);
    await legacySession.getSessionId();
    await legacySession.markSessionCreated();

    const ids = [
      'step-claude',
      'step-codex',
      'replacement-claude',
      'next-step-claude',
      'ab-a',
      'ab-b',
      'ba-a',
      'ba-b',
    ];
    const store = new ProviderSessionStore({
      createSessionId: () => ids.shift()!,
      legacy: { providerKey: 'claude', session: legacySession },
    });

    await store.beginStep('build');
    const firstClaude = await store.prepare('claude');
    await store.markCreated('claude');
    const retryClaude = await store.prepare('claude');
    const switchedCodex = await store.prepare('codex');
    await store.markCreated('codex');
    const replacementClaude = await store.replace('claude');
    const retryAfterReplacement = await store.prepare('claude');
    const codexAfterClaudeReplacement = await store.prepare('codex');

    // A repeated label is still a distinct step execution.
    await store.beginStep('build');
    const nextStepClaude = await store.prepare('claude');
    await store.markCreated('claude');

    const branchAB_A = store.beginBranch('manual_test');
    const branchAB_B = store.beginBranch('prd_audit');
    const branchAB_AFirst = await branchAB_A.prepare('claude');
    const branchAB_BFirst = await branchAB_B.prepare('claude');
    await branchAB_A.markCreated('claude');
    await branchAB_B.markCreated('claude');
    const branchAB_ARetry = await branchAB_A.prepare('claude');
    const branchAB_BRetry = await branchAB_B.prepare('claude');

    const branchBA_A = store.beginBranch('manual_test');
    const branchBA_B = store.beginBranch('prd_audit');
    const branchBA_AFirst = await branchBA_A.prepare('claude');
    const branchBA_BFirst = await branchBA_B.prepare('claude');
    await branchBA_B.markCreated('claude');
    await branchBA_A.markCreated('claude');
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
      firstClaude: { id: 'step-claude', resume: false },
      retryClaude: { id: 'step-claude', resume: true },
      switchedCodex: { id: 'step-codex', resume: false },
      replacementClaude: { id: 'replacement-claude', resume: false },
      retryAfterReplacement: { id: 'replacement-claude', resume: false },
      codexAfterClaudeReplacement: { id: 'step-codex', resume: true },
      nextStepClaude: { id: 'next-step-claude', resume: false },
      branchAB: {
        aFirst: { id: 'ab-a', resume: false },
        bFirst: { id: 'ab-b', resume: false },
        aRetry: { id: 'ab-a', resume: true },
        bRetry: { id: 'ab-b', resume: true },
      },
      branchBA: {
        aFirst: { id: 'ba-a', resume: false },
        bFirst: { id: 'ba-b', resume: false },
        aRetry: { id: 'ba-a', resume: true },
        bRetry: { id: 'ba-b', resume: true },
      },
      serialScopeAfterBranches: { id: 'next-step-claude', created: true },
      legacyAfterBranches: { id: 'next-step-claude', created: true },
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
        serial: { id: 'serial-success', created: false },
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
        serial: { id: 'serial-throw', created: false },
        legacyId: 'serial-throw',
        legacyCreated: false,
      },
    ]);
  });
});
