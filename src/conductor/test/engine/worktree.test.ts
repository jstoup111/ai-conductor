import { describe, it, expect } from 'vitest';
import { slugify } from '../../src/engine/worktree.js';

describe('engine/worktree', () => {
  describe('slugify', () => {
    it('returns lowercase with spaces as hyphens', () => {
      expect(slugify('URL shortener service')).toBe('url-shortener-service');
    });
  });
});
