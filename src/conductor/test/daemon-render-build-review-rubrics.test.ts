import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import chalk from 'chalk';

// daemon-cli transitively imports the provider layer (execa); stub it so this
// pure-formatting test doesn't pull a live process dependency.
vi.mock('execa', () => ({ execa: vi.fn() }));

import { renderDaemonEvent } from '../src/daemon-cli.js';
import type { ConductorEvent } from '../src/types/index.js';

function lines(event: ConductorEvent): string[] {
  const output: string[] = [];
  renderDaemonEvent(event, (line) => output.push(line));
  return output;
}

const originalLevel = chalk.level;
afterEach(() => {
  chalk.level = originalLevel;
});

describe('renderDaemonEvent: build_review rubric lifecycle', () => {
  beforeEach(() => {
    chalk.level = 0;
  });

  it('labels a started rubric branch with its lap tag', () => {
    expect(lines({
      type: 'build_review_rubric_started', rubric: 'testQuality', lapId: 'lap-12345678',
    })).toEqual(['·   build_review [lap-1234] testQuality started']);
  });

  it('labels a cached rubric branch distinctly from a fresh start', () => {
    expect(lines({
      type: 'build_review_cache_hit', rubric: 'testQuality', lapId: 'lap-12345678',
    })).toEqual(['·   build_review [lap-1234] testQuality cache hit']);
  });
});
