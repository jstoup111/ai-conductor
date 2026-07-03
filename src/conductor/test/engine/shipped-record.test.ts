import { describe, it, expect } from 'vitest';
import { specHash } from '../../src/engine/shipped-record.js';

describe('specHash', () => {
  it('is deterministic: same bytes produce identical digest', () => {
    const plan = Buffer.from('plan content here');
    const stories = Buffer.from('story content here');

    const first = specHash(plan, stories);
    const second = specHash(plan, stories);

    expect(first.digest).toBe(second.digest);
  });

  it('treats a trailing newline as equivalent (trims before hashing)', () => {
    const withNewline = specHash(Buffer.from('content\n'), null);
    const withoutNewline = specHash(Buffer.from('content'), null);

    expect(withNewline.digest).toBe(withoutNewline.digest);
  });

  it('is sensitive to a changed interior byte', () => {
    const original = specHash(Buffer.from('content-a-here'), null);
    const changed = specHash(Buffer.from('content-b-here'), null);

    expect(original.digest).not.toBe(changed.digest);
  });

  it('reports storiesIncluded: false when stories are null', () => {
    const result = specHash(Buffer.from('plan only'), null);

    expect(result.storiesIncluded).toBe(false);
  });

  it('does not treat CRLF as equivalent to LF (pinned behavior)', () => {
    const lf = specHash(Buffer.from('line1\nline2'), null);
    const crlf = specHash(Buffer.from('line1\r\nline2'), null);

    expect(lf.digest).not.toBe(crlf.digest);
  });
});
