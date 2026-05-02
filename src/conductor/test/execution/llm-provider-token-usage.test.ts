import { describe, it, expect } from 'vitest';
import type { InvokeResult, TokenUsage } from '../../src/execution/llm-provider.js';

/**
 * Task 1: Compile-time and runtime tests for optional tokenUsage on InvokeResult.
 * These are backwards-compatible — all fields are optional.
 */
describe('InvokeResult tokenUsage field', () => {
  it('InvokeResult without tokenUsage is valid (backwards-compatible)', () => {
    const result: InvokeResult = {
      success: true,
      output: 'hello',
      exitCode: 0,
    };
    expect(result.tokenUsage).toBeUndefined();
  });

  it('InvokeResult with tokenUsage.input and tokenUsage.output is valid', () => {
    const result: InvokeResult = {
      success: true,
      output: 'hello',
      exitCode: 0,
      tokenUsage: { input: 100, output: 50 },
    };
    expect(result.tokenUsage?.input).toBe(100);
    expect(result.tokenUsage?.output).toBe(50);
    expect(result.tokenUsage?.cacheRead).toBeUndefined();
    expect(result.tokenUsage?.cacheCreation).toBeUndefined();
  });

  it('InvokeResult with full tokenUsage including cache fields is valid', () => {
    const result: InvokeResult = {
      success: true,
      output: 'hello',
      exitCode: 0,
      tokenUsage: { input: 200, output: 75, cacheRead: 50, cacheCreation: 10 },
    };
    expect(result.tokenUsage?.cacheRead).toBe(50);
    expect(result.tokenUsage?.cacheCreation).toBe(10);
  });

  it('TokenUsage interface has correct shape', () => {
    const usage: TokenUsage = { input: 10, output: 5 };
    expect(usage.input).toBe(10);
    expect(usage.output).toBe(5);
  });
});
