// Covers: task:11
import { describe, expect, it, vi } from 'vitest';

import {
  openGuidedSession,
  type GuidedSessionLauncher,
} from '../../../src/engine/monitor/session.js';

describe('guided halt sessions', () => {
  it('renders halt evidence into a fresh daemon-triage opening input', async () => {
    const launch = vi.fn<GuidedSessionLauncher>().mockResolvedValue({ kind: 'exited', exitCode: 0 });

    await openGuidedSession({
      provider: 'codex',
      cwd: '/workspace/project/.worktrees/repair-index',
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
        ].join('\n'),
      },
    ]]);
  });
});
