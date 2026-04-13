import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/index.js';

describe('CLI', () => {
  it('parses feature description as positional arg', () => {
    const opts = parseArgs(['node', 'conduct', 'URL shortener']);
    expect(opts.featureDesc).toBe('URL shortener');
  });
});
