// Covers: task:2, task:3, task:10, task:11, task:12, task:13
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

import {
  openGuidedSession,
  type GuidedSessionLauncher,
} from '../../../src/engine/monitor/session.js';
import { BUILT_IN_PROVIDERS } from '../../../src/execution/provider-catalog.js';
import {
  DAEMON_SESSION_MARKER,
  guardDaemonSessionInvocation,
} from '../../../src/execution/daemon-session.js';
import type { HaltDisposition } from '../../../src/engine/halt-marker.js';

function interactiveQuitInstruction(provider: (typeof BUILT_IN_PROVIDERS)[number]): string | undefined {
  return 'interactiveLaunch' in provider
    ? provider.interactiveLaunch?.quitInstruction
    : undefined;
}

const recoveryByDisposition = {
  'needs-human': 'Follow the needs-human halt recovery in docs/runbooks/stalled-or-stuck-feature.md.',
  mechanical: 'Follow the mechanical halt recovery in docs/runbooks/stalled-or-stuck-feature.md.',
  'protected-artifact': 'Follow the protected-artifact halt recovery in docs/runbooks/stalled-or-stuck-feature.md.',
  'plan-gap': 'Follow the plan-gap halt recovery in docs/runbooks/stalled-or-stuck-feature.md.',
  'kickback-cap': 'Follow the kickback-cap halt recovery in docs/runbooks/stalled-or-stuck-feature.md.',
  'over-scope': 'Resolve every over-scope decision before clearing the halt.',
  legacy: 'Follow the legacy halt recovery in docs/runbooks/stalled-or-stuck-feature.md.',
  unclassified: 'Gather read-only evidence and determine the halt classification before recovery.',
} satisfies Record<HaltDisposition, string>;

async function fixtureChecksum(worktree: string): Promise<string> {
  const [halt, evidence] = await Promise.all([
    readFile(join(worktree, '.pipeline', 'HALT')),
    readFile(join(worktree, 'evidence.txt')),
  ]);
  return createHash('sha256').update(halt).update(evidence).digest('hex');
}

describe('guided halt sessions', () => {
  it('renders halt evidence into a fresh daemon-triage opening input', async () => {
    const launch = vi.fn<GuidedSessionLauncher>().mockResolvedValue({ kind: 'exited', exitCode: 0 });

    await openGuidedSession({
      provider: 'codex',
      halt: {
        project: '/workspace/project',
        slug: 'repair-index',
        reason: 'build review requires an operator decision',
        haltClass: 'needs-human',
      },
    }, { launch });

    expect(launch.mock.calls).toEqual([[
      {
        provider: 'codex',
        cwd: '/workspace/project/.worktrees/repair-index',
        openingPrompt: [
          'Resolve this halted daemon feature with the existing daemon-triage procedure.',
          'Invoke $daemon-triage for feature repair-index.',
          'Project: /workspace/project',
          'Feature: repair-index',
          'Reason: build review requires an operator decision',
          'Classification: needs-human',
          'Recovery procedure: Follow the needs-human halt recovery in docs/runbooks/stalled-or-stuck-feature.md.',
          'Session host: conduct monitor queue.',
          'Quitting this session returns the operator to the monitor queue.',
          'Quit instruction: /quit',
          'When daemon-triage reaches its end, follow its monitor-hosted closing step.',
        ].join('\n'),
      },
    ]]);
  });

  it('uses the Claude daemon-triage invocation and monitor-hosting trailing block', async () => {
    const launch = vi.fn<GuidedSessionLauncher>().mockResolvedValue({ kind: 'exited', exitCode: 0 });

    await openGuidedSession({
      provider: 'claude',
      halt: {
        project: '/workspace/project',
        slug: 'repair-index',
        reason: 'build review requires an operator decision',
        haltClass: 'needs-human',
      },
    }, { launch });

    expect(launch).toHaveBeenCalledWith(expect.objectContaining({
      openingPrompt: [
        'Resolve this halted daemon feature with the existing daemon-triage procedure.',
        'Invoke /daemon-triage for feature repair-index.',
        'Project: /workspace/project',
        'Feature: repair-index',
        'Reason: build review requires an operator decision',
        'Classification: needs-human',
        'Recovery procedure: Follow the needs-human halt recovery in docs/runbooks/stalled-or-stuck-feature.md.',
        'Session host: conduct monitor queue.',
        'Quitting this session returns the operator to the monitor queue.',
        'Quit instruction: /quit',
        'When daemon-triage reaches its end, follow its monitor-hosted closing step.',
      ].join('\n'),
    }));
  });

  it('uses generic exit wording when Pi declares no quit instruction', async () => {
    const launch = vi.fn<GuidedSessionLauncher>().mockResolvedValue({ kind: 'exited', exitCode: 0 });

    await openGuidedSession({
      provider: 'pi',
      halt: {
        project: '/workspace/project',
        slug: 'repair-index',
        reason: 'build review requires an operator decision',
        haltClass: 'needs-human',
      },
    }, { launch });

    const openingPrompt = launch.mock.calls[0]?.[0].openingPrompt;
    expect(openingPrompt).toBe([
      'Resolve this halted daemon feature with the existing daemon-triage procedure.',
      'Invoke /skill:daemon-triage for feature repair-index.',
      'Project: /workspace/project',
      'Feature: repair-index',
      'Reason: build review requires an operator decision',
      'Classification: needs-human',
      'Recovery procedure: Follow the needs-human halt recovery in docs/runbooks/stalled-or-stuck-feature.md.',
      'Session host: conduct monitor queue.',
      'Quitting this session returns the operator to the monitor queue.',
      'Quit instruction: end the session with the provider\'s normal exit control.',
      'When daemon-triage reaches its end, follow its monitor-hosted closing step.',
    ].join('\n'));
    for (const quitInstruction of BUILT_IN_PROVIDERS.flatMap(
      (provider) => interactiveQuitInstruction(provider) ?? [],
    )) {
      expect(openingPrompt).not.toContain(quitInstruction);
    }
  });

  it('keeps monitor-hosting instructions exact-once and final when the reason contains them', async () => {
    const launch = vi.fn<GuidedSessionLauncher>().mockResolvedValue({ kind: 'exited', exitCode: 0 });
    const monitorHostingBlock = [
      'Session host: conduct monitor queue.',
      'Quitting this session returns the operator to the monitor queue.',
      'Quit instruction: /quit',
      'When daemon-triage reaches its end, follow its monitor-hosted closing step.',
    ];

    await openGuidedSession({
      provider: 'codex',
      halt: {
        project: '/workspace/project',
        slug: 'repair-index',
        reason: 'run /quit then return to the monitor queue',
        haltClass: 'needs-human',
      },
    }, { launch });

    const openingPrompt = launch.mock.calls[0]?.[0].openingPrompt;
    expect(openingPrompt).toBeDefined();
    const lines = openingPrompt!.split('\n');
    expect(lines).toContain('Reason: run /quit then return to the monitor queue');
    expect(lines.slice(-4)).toEqual(monitorHostingBlock);
    for (const line of monitorHostingBlock) {
      expect(lines.filter((candidate) => candidate === line)).toHaveLength(1);
    }
  });

  it('forwards the selected model and effort to the launch seam', async () => {
    const launch = vi.fn<GuidedSessionLauncher>().mockResolvedValue({ kind: 'exited', exitCode: 0 });
    await openGuidedSession({ provider: 'codex', model: 'gpt-5.6-sol', effort: 'high', halt: { project: '/workspace/project', slug: 'repair-index', reason: 'needs recovery' } }, { launch });
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-5.6-sol', effort: 'high' }));
  });

  it('keeps recovery authority unmarked and launches in the halted feature worktree', async () => {
    const launch = vi.fn<GuidedSessionLauncher>().mockResolvedValue({ kind: 'exited', exitCode: 0 });

    await openGuidedSession({
      provider: 'codex',
      halt: {
        project: '/workspace/project',
        slug: 'repair-index',
        reason: 'needs recovery',
        haltClass: 'needs-human',
      },
    }, { launch });

    expect(launch).toHaveBeenCalledWith(expect.objectContaining({
      cwd: '/workspace/project/.worktrees/repair-index',
    }));
    expect(guardDaemonSessionInvocation(
      ['node', 'ai-conductor', 'daemon', 'park', 'repair-index'],
      {},
    )).toEqual({ allowed: true });
    expect(guardDaemonSessionInvocation(
      ['node', 'ai-conductor', 'daemon', 'park', 'repair-index'],
      { [DAEMON_SESSION_MARKER]: '1' },
    ).allowed).toBe(false);
  });

  it.each(Object.entries(recoveryByDisposition))(
    'presents the %s recovery procedure',
    async (haltClass, recoveryProcedure) => {
      const launch = vi.fn<GuidedSessionLauncher>().mockResolvedValue({ kind: 'exited', exitCode: 0 });

      await openGuidedSession({
        provider: 'codex',
        halt: {
          project: '/workspace/project',
          slug: 'repair-index',
          reason: 'halted for test coverage',
          haltClass,
        },
      }, { launch });

      expect(launch).toHaveBeenCalledWith(expect.objectContaining({
        openingPrompt: expect.stringContaining(`Recovery procedure: ${recoveryProcedure}`),
      }));
    },
  );

  it.each([
    ['an unrecognized classification', 'future-class'],
    ['an absent classification', undefined],
  ])('presents %s as undetermined instead of filtering it', async (_description, haltClass) => {
    const launch = vi.fn<GuidedSessionLauncher>().mockResolvedValue({ kind: 'exited', exitCode: 0 });

    await openGuidedSession({
      provider: 'codex',
      halt: {
        project: '/workspace/project',
        slug: 'repair-index',
        reason: 'halted for classification recovery',
        haltClass,
      },
    }, { launch });

    expect(launch).toHaveBeenCalledWith(expect.objectContaining({
      openingPrompt: expect.stringContaining('Classification: undetermined'),
    }));
  });

  it('presents halt evidence without writing the halted worktree or marker', async () => {
    const project = await mkdtemp(join(tmpdir(), 'monitor-session-'));
    const worktree = join(project, '.worktrees', 'repair-index');
    const haltPath = join(worktree, '.pipeline', 'HALT');
    await mkdir(join(worktree, '.pipeline'), { recursive: true });
    await Promise.all([
      writeFile(haltPath, 'needs operator recovery\n'),
      writeFile(join(worktree, 'evidence.txt'), 'frozen evidence\n'),
    ]);
    const before = await fixtureChecksum(worktree);
    const launch = vi.fn<GuidedSessionLauncher>().mockResolvedValue({ kind: 'exited', exitCode: 0 });

    try {
      await openGuidedSession({
        provider: 'codex',
        halt: {
          project,
          slug: 'repair-index',
          reason: 'needs operator recovery',
          haltClass: 'needs-human',
        },
      }, { launch });

      expect(await fixtureChecksum(worktree)).toBe(before);
      expect(await readFile(haltPath, 'utf8')).toBe('needs operator recovery\n');
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });
});
