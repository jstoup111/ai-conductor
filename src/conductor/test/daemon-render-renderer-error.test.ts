// Covers: task:8
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import chalk from 'chalk';

vi.mock('execa', () => ({ execa: vi.fn() }));

import { renderDaemonEvent } from '../src/daemon-cli.js';

const originalLevel = chalk.level;
afterEach(() => {
  chalk.level = originalLevel;
});

function lines(rendererName: string): string[] {
  const output: string[] = [];
  renderDaemonEvent(
    { type: 'renderer_error', rendererName, error: 'export failed: 503' },
    (line) => output.push(line),
  );
  return output;
}

describe('renderDaemonEvent: renderer_error', () => {
  beforeEach(() => {
    chalk.level = 0;
  });

  it('logs one warning naming the OpenTelemetry renderer and error', () => {
    expect(lines('otel')).toEqual(['· ⚠ renderer otel failed: export failed: 503']);
  });

  it('logs one warning naming a non-OpenTelemetry renderer', () => {
    expect(lines('terminal')).toEqual(['· ⚠ renderer terminal failed: export failed: 503']);
  });
});
