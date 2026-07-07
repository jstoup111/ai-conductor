// brain-liveness.test.ts — brainLoopAlive() detects a running brain loop via
// pidfile OR tmux session, per the single-writer gate (ADR Q2).

import { describe, it, expect } from 'vitest';
import { brainLoopAlive } from '../../../src/engine/engineer/brain-liveness.js';

describe('brainLoopAlive', () => {
  it('returns false when neither pidfile nor tmux session exist', () => {
    expect(
      brainLoopAlive({
        pidfileExists: () => false,
        tmuxHasSession: () => false,
      }),
    ).toBe(false);
  });

  it('returns true when the pidfile exists (tmux absent)', () => {
    expect(
      brainLoopAlive({
        pidfileExists: () => true,
        tmuxHasSession: () => false,
      }),
    ).toBe(true);
  });

  it('returns true when a cc-brain-* tmux session exists (pidfile absent)', () => {
    let queriedPrefix: string | undefined;
    expect(
      brainLoopAlive({
        pidfileExists: () => false,
        tmuxHasSession: (prefix) => {
          queriedPrefix = prefix;
          return true;
        },
      }),
    ).toBe(true);
    expect(queriedPrefix).toBe('cc-brain-');
  });

  it('checks the pidfile at the given path', () => {
    let checkedPath: string | undefined;
    brainLoopAlive({
      pidfilePath: '/tmp/custom-brain.pid',
      pidfileExists: (p) => {
        checkedPath = p;
        return false;
      },
      tmuxHasSession: () => false,
    });
    expect(checkedPath).toBe('/tmp/custom-brain.pid');
  });

  it('short-circuits the tmux check when the pidfile already indicates liveness', () => {
    let tmuxCalled = false;
    expect(
      brainLoopAlive({
        pidfileExists: () => true,
        tmuxHasSession: () => {
          tmuxCalled = true;
          return false;
        },
      }),
    ).toBe(true);
    expect(tmuxCalled).toBe(false);
  });
});
