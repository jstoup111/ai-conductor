import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Writable } from 'node:stream';
import { createRenderer } from '../src/ui/create-renderer.js';
import { createLiveRegion } from '../src/ui/live-region.js';
import type { ConductorEvent, ConductState } from '../src/types/index.js';
import { ALL_STEPS } from '../src/engine/steps.js';

class CaptureStream extends Writable {
  chunks: string[] = [];
  _write(chunk: Buffer | string, _e: string, cb: (err?: Error | null) => void): void {
    this.chunks.push(chunk.toString());
    cb();
  }
  output(): string {
    return this.chunks.join('');
  }
}

describe('createRenderer — build progress/no-progress/stall', () => {
  let readStateMock: (path: string) => Promise<{ ok: true; value: ConductState }>;
  let renderer: (event: ConductorEvent) => Promise<void>;
  let stream: CaptureStream;

  beforeEach(() => {
    const state: ConductState = {
      feature_desc: 'Add login',
      complexity_tier: 'M',
      worktree: 'done',
      memory: 'done',
      brainstorm: 'in_progress',
      plan: 'done',
    };

    readStateMock = vi.fn(async () => ({ ok: true as const, value: state }));
    stream = new CaptureStream();

    renderer = createRenderer({
      stateFilePath: '/tmp/test-state.json',
      featureDesc: 'Add login',
      steps: ALL_STEPS,
      readStateFn: readStateMock,
      liveRegion: createLiveRegion({ stream, forceTTY: false }),
    });
  });

  it('renders a human-readable line for build_progress with task counts', async () => {
    await renderer({
      type: 'build_progress',
      step: 'build',
      resolved: 3,
      total: 10,
      currentTaskId: 'T-4',
      currentTaskName: 'Wire up the widget',
    });

    const output = stream.output();
    expect(output).toContain('build');
    expect(output).toContain('3');
    expect(output).toContain('10');
    expect(output).toContain('T-4');
    expect(output).toContain('Wire up the widget');
  });

  it('renders build_progress without an optional current task', async () => {
    await renderer({
      type: 'build_progress',
      step: 'build',
      resolved: 1,
      total: 5,
    });

    const output = stream.output();
    expect(output).toContain('1');
    expect(output).toContain('5');
  });

  it('renders a human-readable warning line for build_no_progress with quiet minutes', async () => {
    await renderer({
      type: 'build_no_progress',
      step: 'build',
      quietMinutes: 15,
      resolved: 2,
      total: 8,
      currentTaskId: 'T-2',
    });

    const output = stream.output();
    expect(output).toContain('build');
    expect(output).toContain('15');
    expect(output).toContain('T-2');
  });

  it('renders a human-readable halt line for build_stall', async () => {
    await renderer({
      type: 'build_stall',
      step: 'build',
      reason: 'no_task_progress',
      resolvedBefore: 2,
      resolvedAfter: 2,
    });

    const output = stream.output();
    expect(output).toContain('build');
    expect(output).toContain('no_task_progress');
  });

  it('produces distinct output for progress, no-progress, and stall', async () => {
    await renderer({ type: 'build_progress', step: 'build', resolved: 1, total: 5 });
    const progressOutput = stream.output();

    const stream2 = new CaptureStream();
    const renderer2 = createRenderer({
      stateFilePath: '/tmp/test-state.json',
      featureDesc: 'Add login',
      steps: ALL_STEPS,
      readStateFn: readStateMock,
      liveRegion: createLiveRegion({ stream: stream2, forceTTY: false }),
    });
    await renderer2({
      type: 'build_no_progress',
      step: 'build',
      quietMinutes: 10,
      resolved: 1,
      total: 5,
    });
    const noProgressOutput = stream2.output();

    const stream3 = new CaptureStream();
    const renderer3 = createRenderer({
      stateFilePath: '/tmp/test-state.json',
      featureDesc: 'Add login',
      steps: ALL_STEPS,
      readStateFn: readStateMock,
      liveRegion: createLiveRegion({ stream: stream3, forceTTY: false }),
    });
    await renderer3({
      type: 'build_stall',
      step: 'build',
      reason: 'halt_marker',
      resolvedBefore: 1,
      resolvedAfter: 1,
    });
    const stallOutput = stream3.output();

    expect(progressOutput).not.toEqual(noProgressOutput);
    expect(noProgressOutput).not.toEqual(stallOutput);
    expect(progressOutput).not.toEqual(stallOutput);
  });

  it('no-ops without throwing for an unknown event kind', async () => {
    await expect(
      renderer({ type: 'totally_unknown_event' } as unknown as ConductorEvent),
    ).resolves.not.toThrow();
  });
});
