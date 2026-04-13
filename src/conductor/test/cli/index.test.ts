import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/index.js';

describe('CLI', () => {
  it('parses feature description as positional arg', () => {
    const opts = parseArgs(['node', 'conduct', 'URL shortener']);
    expect(opts.featureDesc).toBe('URL shortener');
  });

  it('parses --resume flag', () => {
    const opts = parseArgs(['node', 'conduct', '--resume']);
    expect(opts.resume).toBe(true);
  });

  it('parses --auto flag and sets mode to auto', () => {
    const opts = parseArgs(['node', 'conduct', 'feature', '--auto']);
    expect(opts.auto).toBe(true);
  });

  it('parses --status flag', () => {
    const opts = parseArgs(['node', 'conduct', '--status']);
    expect(opts.status).toBe(true);
  });

  it('parses --from <step> flag', () => {
    const opts = parseArgs(['node', 'conduct', 'feature', '--from', 'plan']);
    expect(opts.from).toBe('plan');
  });

  it('parses --cleanup flag', () => {
    const opts = parseArgs(['node', 'conduct', '--cleanup']);
    expect(opts.cleanup).toBe(true);
  });

  it('parses --step <step> flag', () => {
    const opts = parseArgs(['node', 'conduct', '--step', 'brainstorm']);
    expect(opts.step).toBe('brainstorm');
  });

  it('parses --reset flag', () => {
    const opts = parseArgs(['node', 'conduct', '--reset']);
    expect(opts.reset).toBe(true);
  });

  it('parses --output flag', () => {
    const opts = parseArgs(['node', 'conduct', 'feature', '--output']);
    expect(opts.output).toBe(true);
  });

  it('requires feature description when no state exists', () => {
    expect(() => parseArgs(['node', 'conduct'])).toThrow();
  });
});
