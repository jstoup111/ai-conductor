import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/cli.js';

describe('--report CLI flag', () => {
  it('parseArgs(["--report"]) sets report: true', () => {
    const opts = parseArgs(['node', 'conduct', '--report']);
    expect(opts.report).toBe(true);
  });

  it('report defaults to false when --report not passed', () => {
    const opts = parseArgs(['node', 'conduct', 'my feature']);
    expect(opts.report).toBe(false);
  });

  it('--report can be combined with other flags', () => {
    const opts = parseArgs(['node', 'conduct', '--report', '--resume']);
    expect(opts.report).toBe(true);
    expect(opts.resume).toBe(true);
  });
});
