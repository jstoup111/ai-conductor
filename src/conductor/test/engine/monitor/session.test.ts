// Covers: task:11, task:12, task:13
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';

import {
  openGuidedSession,
  type GuidedSessionLauncher,
} from '../../../src/engine/monitor/session.js';
import {
  DAEMON_SESSION_MARKER,
  guardDaemonSessionInvocation,
} from '../../../src/execution/daemon-session.js';
import type { HaltDisposition } from '../../../src/engine/halt-marker.js';

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
        ].join('\n'),
      },
    ]]);
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
