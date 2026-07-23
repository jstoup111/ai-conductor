import { describe, expect, it } from 'vitest';
import { parseSourceRef } from '../../../../src/engine/engineer/intake/source-ref';

describe('parseSourceRef', () => {
  it('parses owner/repo#n into repo and issue', () => {
    expect(parseSourceRef('jstoup111/ai-conductor#538')).toEqual({
      repo: 'jstoup111/ai-conductor',
      issue: '538',
    });
  });

  it('returns null when there is no #n suffix', () => {
    expect(parseSourceRef('owner/repo')).toBeNull();
  });

  it('returns null when the issue part is not numeric', () => {
    expect(parseSourceRef('owner/repo#abc')).toBeNull();
  });
});
