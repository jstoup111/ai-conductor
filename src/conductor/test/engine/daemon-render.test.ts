import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import chalk from 'chalk';

// daemon-cli transitively imports the provider layer (execa); stub it so this
// pure-formatting test doesn't pull a live process dependency.
vi.mock('execa', () => ({ execa: vi.fn() }));

import { renderDaemonEvent } from '../../src/daemon-cli.js';
import type { ConductorEvent } from '../../src/types/index.js';

// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*m/;

function lines(event: ConductorEvent): string[] {
  const out: string[] = [];
  renderDaemonEvent(event, (m) => out.push(m));
  return out;
}

const originalLevel = chalk.level;
afterEach(() => {
  chalk.level = originalLevel;
});

describe('renderDaemonEvent', () => {
  // Force color off so the formatting assertions below are byte-exact and
  // independent of the runner's TTY / FORCE_COLOR state.
  beforeEach(() => {
    chalk.level = 0;
  });

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
    ).toEqual(['↩ KICKBACK: build re-opened plan — AC missing (×1)']);
  });

  it('renders kickback with a ×N counter greater than one', () => {
    expect(
      lines({ type: 'kickback', from: 'build', to: 'plan', evidence: 'AC missing', count: 2 }),
    ).toEqual(['↩ KICKBACK: build re-opened plan — AC missing (×2)']);
  });

  it('renders kickback without a dangling separator when evidence is missing', () => {
    expect(
      lines({ type: 'kickback', from: 'build', to: 'plan', evidence: undefined, count: 1 }),
    ).toEqual(['↩ KICKBACK: build re-opened plan (×1)']);
  });

  it('renders navigation_back as an operator BACK line', () => {
    expect(
      lines({ type: 'navigation_back', from: 'manual_test', to: 'build' }),
    ).toEqual(['↰ BACK: manual_test → build (operator)']);
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

describe('renderDaemonEvent coloring', () => {
  it('emits ANSI color when the terminal supports it', () => {
    chalk.level = 1;
    const [line] = lines({ type: 'step_completed', step: 'build', status: 'done' });
    expect(line).toMatch(ANSI);
    // Text content is preserved underneath the color codes.
    // eslint-disable-next-line no-control-regex
    expect(line.replace(/\[[0-9;]*m/g, '')).toBe('·   build ✓ done');
  });

  it('stays plain text when color is disabled (NO_COLOR / non-TTY)', () => {
    chalk.level = 0;
    const [line] = lines({ type: 'step_failed', step: 'build', error: 'boom', retryCount: 2 });
    expect(line).not.toMatch(ANSI);
    expect(line).toBe('· ✗ build failed (try 2): boom');
  });

  it('emits ANSI color for kickback lines with text preserved underneath', () => {
    chalk.level = 1;
    const [line] = lines({
      type: 'kickback',
      from: 'build',
      to: 'plan',
      evidence: 'AC missing',
      count: 1,
    });
    expect(line).toMatch(ANSI);
    // eslint-disable-next-line no-control-regex
    expect(line.replace(/\[[0-9;]*m/g, '')).toBe('↩ KICKBACK: build re-opened plan — AC missing (×1)');
  });

  it('emits ANSI color for navigation_back lines with text preserved underneath', () => {
    chalk.level = 1;
    const [line] = lines({ type: 'navigation_back', from: 'manual_test', to: 'build' });
    expect(line).toMatch(ANSI);
    // eslint-disable-next-line no-control-regex
    expect(line.replace(/\x1b\[[0-9;]*m/g, '')).toBe('↰ BACK: manual_test → build (operator)');
  });
});
