import { describe, it, expect, vi } from 'vitest';

// daemon-cli transitively imports the provider layer (execa); stub it so this
// pure-formatting test doesn't pull a live process dependency.
vi.mock('execa', () => ({ execa: vi.fn() }));

import { renderDaemonEvent } from '../../src/daemon-cli.js';
import type { ConductorEvent } from '../../src/types/index.js';

function lines(event: ConductorEvent): string[] {
  const out: string[] = [];
  renderDaemonEvent(event, (m) => out.push(m));
  return out;
}

describe('renderDaemonEvent', () => {
  it('renders step boundaries', () => {
    expect(lines({ type: 'step_started', step: 'build', index: 5 })).toEqual(['· ▶ build']);
    expect(lines({ type: 'step_completed', step: 'build', status: 'done' })).toEqual([
      '·   build ✓ done',
    ]);
  });

  it('renders failures', () => {
    expect(lines({ type: 'step_failed', step: 'build', error: 'boom', retryCount: 2 })).toEqual([
      '· ✗ build failed (try 2): boom',
    ]);
  });

  it('renders kickback with the ×N counter', () => {
    expect(
      lines({ type: 'kickback', from: 'build', to: 'plan', evidence: 'AC missing', count: 1 }),
    ).toEqual(['· ↩ kickback: build re-opened plan — AC missing (×1)']);
  });

  it('renders halt and convergence', () => {
    expect(lines({ type: 'loop_halt', reason: 'cap' })).toEqual(['· ✋ loop halted: cap']);
    expect(lines({ type: 'loop_converged' })).toEqual(['· ✓ gate loop converged']);
  });

  it('shows only UNSATISFIED gate verdicts (satisfied ones are routine)', () => {
    expect(lines({ type: 'gate_verdict', step: 'plan', satisfied: true })).toEqual([]);
    expect(
      lines({ type: 'gate_verdict', step: 'plan', satisfied: false, reason: 'uncovered' }),
    ).toEqual(['· gate plan: unsatisfied — uncovered']);
  });
});
