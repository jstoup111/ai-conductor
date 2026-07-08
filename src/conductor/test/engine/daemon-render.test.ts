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

  it('renders ci_failed event with ✋ halt-monitor marker', () => {
    expect(
      lines({
        type: 'ci_failed',
        prUrl: 'https://github.com/org/repo/pull/123',
        slug: 'org/repo',
        checks: ['test', 'lint'],
        attempts: 1,
        phase: 'detected',
      }),
    ).toEqual(['· ✋ ci_failed[org/repo]: phase=detected attempts=1 checks=[test,lint]']);
  });

  it('renders ci_failed exhausted phase', () => {
    expect(
      lines({
        type: 'ci_failed',
        prUrl: 'https://github.com/org/repo/pull/456',
        slug: 'myorg/myrepo',
        checks: ['build'],
        attempts: 2,
        phase: 'exhausted',
      }),
    ).toEqual(['· ✋ ci_failed[myorg/myrepo]: phase=exhausted attempts=2 checks=[build]']);
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

describe('renderDaemonEvent distinctness and completeness guards', () => {
  beforeEach(() => {
    chalk.level = 0;
  });

  it('keeps kickback and navigation_back (BACK) lines textually distinct', () => {
    const [kickbackLine] = lines({
      type: 'kickback',
      from: 'build',
      to: 'plan',
      evidence: 'AC missing',
      count: 1,
    });
    const [backLine] = lines({ type: 'navigation_back', from: 'manual_test', to: 'build' });

    expect(kickbackLine).toContain('KICKBACK');
    expect(kickbackLine).not.toContain('(operator)');

    expect(backLine).toContain('BACK');
    expect(backLine).toContain('(operator)');
    expect(backLine).not.toContain('KICKBACK');

    // \bKICKBACK\b matches only the kickback line, not the back line.
    expect(kickbackLine).toMatch(/\bKICKBACK\b/);
    expect(backLine).not.toMatch(/\bKICKBACK\b/);
  });

  it('renders exactly the previously-rendering event types plus navigation_back', () => {
    // One minimal, valid sample per ConductorEvent variant (see types/events.ts).
    // Some variants (e.g. gate_verdict) only render conditionally; the sample
    // below is chosen so it *would* render if the type is wired up, so this
    // guard fails loudly if a new/other type starts unexpectedly rendering.
    const samples: ConductorEvent[] = [
      { type: 'step_started', step: 'build', index: 0 },
      { type: 'step_completed', step: 'build', status: 'done' },
      { type: 'step_failed', step: 'build', error: 'boom', retryCount: 1 },
      { type: 'step_retry', step: 'build', attempt: 1, maxAttempts: 3, reason: 'retry' },
      { type: 'checkpoint_reached', step: 'build' },
      { type: 'recovery_needed', step: 'build', options: ['retry'] },
      { type: 'gate_blocked', step: 'build', reason: 'blocked' },
      { type: 'tier_skip', step: 'build', tier: 'S' },
      { type: 'config_skip', step: 'build' },
      { type: 'navigation_back', from: 'manual_test', to: 'build' },
      { type: 'rate_limit', waitSeconds: 30 },
      { type: 'session_reset', reason: 'context refresh' },
      { type: 'credentials_park', reason: 'expired' },
      { type: 'feature_complete', prUrl: 'https://example.com/pr/1' },
      { type: 'dashboard_refresh' },
      { type: 'auto_heal', step: 'build', healed: 1, skipped: 0 },
      { type: 'mode_skip', step: 'build', mode: 'partial', reason: 'skip' },
      {
        type: 'build_stall',
        step: 'build',
        reason: 'no_task_progress',
        resolvedBefore: 0,
        resolvedAfter: 0,
      },
      { type: 'renderer_error', rendererName: 'tty', error: 'boom' },
      { type: 'when_skip', step: 'build', expression: '${x}', undefinedKey: 'x' },
      { type: 'parallel_started', step: 'build', branches: ['a', 'b'] },
      { type: 'parallel_completed', step: 'build', branches: ['a', 'b'] },
      { type: 'parallel_failure', step: 'build', branch: 'a', error: 'boom' },
      { type: 'gate_verdict', step: 'build', satisfied: false, reason: 'unsatisfied' },
      { type: 'kickback', from: 'prd_audit', to: 'build', count: 1 },
      { type: 'loop_halt', reason: 'stuck' },
      { type: 'loop_converged' },
      { type: 'rebase_noop' },
      { type: 'rebase_changed', changedPaths: ['a.ts'] },
      { type: 'rebase_changelog_resolved' },
      { type: 'rebase_conflict_halt', reason: 'conflict', conflicts: ['a.ts'] },
      { type: 'rebase_resolution_attempt', index: 1, cap: 3 },
      { type: 'rebase_resolution_succeeded' },
      { type: 'rebase_resolution_failed' },
      { type: 'rebase_resolution_exhausted' },
      {
        type: 'ci_failed',
        prUrl: 'https://github.com/org/repo/pull/1',
        slug: 'org/repo',
        checks: ['test'],
        attempts: 1,
        phase: 'detected',
      },
    ];

    const renderingTypes = new Set(
      samples.filter((event) => lines(event).length > 0).map((event) => event.type),
    );

    const previousRenderingTypes = new Set([
      'step_started',
      'step_completed',
      'step_failed',
      'step_retry',
      'gate_verdict',
      'kickback',
      'loop_halt',
      'loop_converged',
      'rate_limit',
      'session_reset',
    ]);
    const expected = new Set([...previousRenderingTypes, 'navigation_back', 'ci_failed']);

    expect(renderingTypes).toEqual(expected);
  });
});
