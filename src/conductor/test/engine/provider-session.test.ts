import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderSessionStore } from '../../src/engine/provider-session.js';
import { SessionManager } from '../../src/execution/session.js';

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
});
