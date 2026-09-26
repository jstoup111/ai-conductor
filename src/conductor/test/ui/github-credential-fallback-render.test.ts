// Covers: task:6
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Writable } from 'node:stream';
import chalk from 'chalk';

vi.mock('execa', () => ({ execa: vi.fn() }));

import { renderDaemonEvent } from '../../src/daemon-cli.js';
import { TerminalRenderer } from '../../src/ui/terminal-renderer.js';
import { createLiveRegion } from '../../src/ui/live-region.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductorEvent } from '../../src/types/index.js';

const event: Extract<ConductorEvent, { type: 'github_write_credential_fallback' }> = {
  type: 'github_write_credential_fallback',
  operation: 'issue.comment.create',
  target: { repository: 'acme/widgets', kind: 'issue', number: 42 },
  reason: 'auth-refused',
};

class CaptureStream extends Writable {
  chunks: string[] = [];
  _write(chunk: Buffer | string, _e: string, cb: (err?: Error | null) => void): void {
    this.chunks.push(chunk.toString());
    cb();
  }
}

const originalLevel = chalk.level;
beforeEach(() => { chalk.level = 0; });
afterEach(() => { chalk.level = originalLevel; });

function expectOperationTargetReason(line: string): void {
  expect(line).toContain(event.operation);
  expect(line).toContain('acme/widgets#42');
  expect(line).toContain('auth-refused');
}

describe('github_write_credential_fallback rendering', () => {
  it('daemon renderer names operation, target, and reason on one line', () => {
    const out: string[] = [];
    renderDaemonEvent(event, (line) => out.push(line));
    expect(out).toHaveLength(1);
    expectOperationTargetReason(out[0]);
  });

  it('terminal renderer names operation, target, and reason on one line', async () => {
    const stream = new CaptureStream();
    const renderer = new TerminalRenderer({
      stateFilePath: '/tmp/test-state.json',
      featureDesc: 'x',
      steps: ALL_STEPS,
      readStateFn: vi.fn(async () => ({ ok: true as const, value: {} as never })),
      liveRegion: createLiveRegion({ stream, forceTTY: false }),
    });
    await renderer.handle(event);
    const line = stream.chunks.join('').split('\n').find((l) => l.includes('fallback')) ?? '';
    expectOperationTargetReason(line);
  });
});
