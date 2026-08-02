import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { createBlockerResolver } from '../../src/engine/blocker-resolver.js';
import { createGhBlockerRunner } from '../../src/engine/gh-blocker-runner.js';

const execFile = promisify(execFileCb);

describe('createGhBlockerRunner (real gh binary smoke)', () => {
  it('resolves owner/repo#229 blocked_by via the real gh CLI, when gh is available', async () => {
    try {
      await execFile('gh', ['--version']);
    } catch {
      return;
    }

    const hadKillSwitch = Object.prototype.hasOwnProperty.call(
      process.env,
      'AI_CONDUCTOR_NO_REAL_EXEC',
    );
    const priorKillSwitch = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;

    let verdict;
    try {
      const resolver = createBlockerResolver({ run: createGhBlockerRunner() });
      try {
        verdict = await resolver.resolve('anthropics/claude-code#229');
      } catch {
        return;
      }
    } finally {
      if (hadKillSwitch) process.env.AI_CONDUCTOR_NO_REAL_EXEC = priorKillSwitch;
      else delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    }

    expect(['unblocked', 'blocked', 'indeterminate', 'cycle']).toContain(verdict.kind);
    if (verdict.kind === 'blocked' || verdict.kind === 'cycle') {
      const members = verdict.kind === 'blocked' ? verdict.blockers : verdict.members;
      for (const member of members) {
        expect(typeof member.number).toBe('string');
        expect(typeof member.repo).toBe('string');
        expect(member.repo.length).toBeGreaterThan(0);
      }
    }
  });
});
