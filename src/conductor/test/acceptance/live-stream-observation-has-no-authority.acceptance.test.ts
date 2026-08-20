/**
 * Acceptance coverage for Story 7 in
 * `.docs/stories/subagent-activity-and-live-per-step-token-burn-are.md`.
 *
 * WHY ACCEPTANCE-LEVEL: this drives the real autonomous Claude provider entry
 * point from subprocess stdout through stream observation and terminal result
 * classification. The subprocess is a deterministic third-party-boundary
 * fake; provider parsing, callbacks, completion classification, activity
 * pulses, and elapsed-time observation are real.
 *
 * PRE-IMPLEMENTATION RED: autonomous Claude output is still parsed as one JSON
 * object and InvokeOptions has no provider-stream callback. The assertions
 * therefore fail on the missing streamed-observation behavior, not on test
 * collection, infrastructure, or a real provider call.
 */

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { ClaudeProvider } from '../../src/execution/claude-provider.js';
import type {
  InvokeOptions,
  InvokeResult,
} from '../../src/execution/llm-provider.js';
import type { IntervalClock } from '../../src/execution/observed-interval.js';

interface ScriptedSubprocessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  failed: boolean;
}

function scriptedClock(...readings: number[]): IntervalClock {
  return {
    nowMs: () => {
      const reading = readings.shift();
      if (reading === undefined) throw new Error('scripted acceptance clock exhausted');
      return reading;
    },
  };
}

function subprocessFactory(chunks: string[], result: ScriptedSubprocessResult) {
  return () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const completion = new Promise<ScriptedSubprocessResult>((resolve) => {
      queueMicrotask(() => {
        for (const chunk of chunks) stdout.emit('data', Buffer.from(chunk));
        resolve(result);
      });
    });
    return Object.assign(completion, { stdout, stderr });
  };
}

function invoke(
  chunks: string[],
  stdout: string,
  options: Partial<InvokeOptions> = {},
  exitCode = 0,
): Promise<InvokeResult> {
  const provider = new ClaudeProvider(
    scriptedClock(1_000, 1_025),
    subprocessFactory(chunks, {
      stdout,
      stderr: '',
      exitCode,
      failed: exitCode !== 0,
    }) as never,
  );
  const invokeOptions: InvokeOptions = {
    prompt: 'observe this autonomous dispatch',
    sessionId: 'acceptance-session',
    resume: false,
    ...options,
  };
  return provider.invoke(invokeOptions);
}

describe('Story 7: stream observation never gains authority over an autonomous dispatch', () => {
  it('preserves the observer-free result, heartbeat pulses, and interval when every observation callback throws', async () => {
    const assistant = JSON.stringify({
      type: 'assistant',
      usage: {
        input_tokens: 7,
        output_tokens: 3,
        cache_read_input_tokens: 11,
        cache_creation_input_tokens: 5,
      },
    });
    const terminal = JSON.stringify({
      type: 'result',
      result: 'dispatch completed',
      usage: {
        input_tokens: 7,
        output_tokens: 3,
        cache_read_input_tokens: 11,
        cache_creation_input_tokens: 5,
      },
      total_cost_usd: 0.02,
      num_turns: 1,
      duration_ms: 20,
    });
    const stream = `${assistant}\nnot-a-provider-record\n${terminal}\n`;
    const splitAt = Math.floor(assistant.length / 2);
    const chunks = [stream.slice(0, splitAt), stream.slice(splitAt, splitAt + 9), stream.slice(splitAt + 9)];
    const baselineActivity = vi.fn();
    const onActivity = vi.fn();
    const onProviderStream = vi.fn(() => {
      throw new Error('observer sink unavailable');
    });

    const baseline = await invoke(chunks, stream, { onActivity: baselineActivity });
    const result = await invoke(chunks, stream, { onActivity, onProviderStream });

    expect(onProviderStream).toHaveBeenCalled();
    expect(onActivity).toHaveBeenCalledTimes(baselineActivity.mock.calls.length);
    expect(result).toEqual(baseline);
    expect(result).toMatchObject({
      success: true,
      output: 'dispatch completed',
      exitCode: 0,
      tokenUsage: {
        input: 7,
        output: 3,
        cacheRead: 11,
        cacheCreation: 5,
        costUsd: 0.02,
        numTurns: 1,
        durationMs: 20,
      },
      observedIntervals: [{ startedAtMs: 1_000, durationMs: 25 }],
    });
  });

  it('keeps child work unknown when no stream record parses and discards a killed partial record without observer errors', async () => {
    const partial = '{"type":"assistant","usage":{"input_tokens":99';
    const unparseableStream = `not-json\n${partial}`;
    const heartbeat = vi.fn();
    const onProviderStream = vi.fn(() => {
      throw new Error('must not run for unparseable records');
    });

    const result = await invoke(
      ['not-json\n', partial],
      unparseableStream,
      { onActivity: heartbeat, onProviderStream },
      1,
    );

    // No callback means no observed child count; dashboard rendering remains "children: unknown".
    expect(onProviderStream).not.toHaveBeenCalled();
    expect(heartbeat).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      success: false,
      output: unparseableStream,
      exitCode: 1,
      tokenUsage: undefined,
      observedIntervals: [{ startedAtMs: 1_000, durationMs: 25 }],
    });
  });
});
