// Covers: task:2
import type { DaemonEventDepthTable } from '../../src/engine/daemon-line-shape.js';
import { describe, it } from 'vitest';

// A missing rendered event must be a compile-time error, not an unmarked log
// line that reaches an operator at runtime.
// @ts-expect-error kickback is required by DaemonEventDepthTable
const incomplete: DaemonEventDepthTable = {
  step_started: 1,
};

void incomplete;

describe('DaemonEventDepthTable', () => {
  it('is checked by TypeScript', () => {});
});
