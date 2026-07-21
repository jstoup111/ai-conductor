import { describe, it, expect } from 'vitest';
import {
  parseIntakeFormBody,
  computeLabelsToApply,
} from '../src/engine/intake-label-sync.js';

const formBody = (opts: { priority?: string; size?: string; dependsOn?: string }) => `### Observed

Something broke.

### Impact

Users can't do X.

### Desired outcome

X should work.

### Hypotheses

_No response_

### Priority

${opts.priority ?? '_No response_'}

### Size

${opts.size ?? '_No response_'}

### Depends on

${opts.dependsOn ?? '_No response_'}
`;

describe('parseIntakeFormBody — issue-form field extraction', () => {
  it('parses valid priority, size, and depends-on fields', () => {
    const body = formBody({ priority: 'high', size: 'L', dependsOn: '#123, #456' });
    expect(parseIntakeFormBody(body)).toEqual({
      priority: 'high',
      size: 'L',
      blockedBy: [123, 456],
    });
  });

  it('defaults unparsable priority to medium', () => {
    const body = formBody({ priority: 'urgent!!', size: 'M' });
    expect(parseIntakeFormBody(body).priority).toBe('medium');
  });

  it('defaults unparsable/missing size to M', () => {
    const body = formBody({ priority: 'low', size: 'XL' });
    expect(parseIntakeFormBody(body).size).toBe('M');
  });

  it('treats "_No response_" depends-on as no dependencies', () => {
    const body = formBody({ priority: 'critical', size: 'S' });
    expect(parseIntakeFormBody(body).blockedBy).toEqual([]);
  });

  it('treats "none" depends-on as no dependencies', () => {
    const body = formBody({ priority: 'critical', size: 'S', dependsOn: 'none' });
    expect(parseIntakeFormBody(body).blockedBy).toEqual([]);
  });

  it('defaults both fields when body is empty/garbage', () => {
    expect(parseIntakeFormBody('garbage with no headings')).toEqual({
      priority: 'medium',
      size: 'M',
      blockedBy: [],
    });
  });
});

describe('computeLabelsToApply — idempotent label diffing', () => {
  it('applies priority and size labels to an issue with no existing labels', () => {
    const parsed = parseIntakeFormBody(formBody({ priority: 'high', size: 'L' }));
    const result = computeLabelsToApply(parsed, []);
    expect(result).toContain('priority:high');
    expect(result).toContain('size:L');
  });

  it('adds blocked_by labels for each dependency', () => {
    const parsed = parseIntakeFormBody(formBody({ priority: 'high', size: 'L', dependsOn: '#7' }));
    const result = computeLabelsToApply(parsed, []);
    expect(result).toContain('blocked_by:#7');
  });

  it('is idempotent: re-computing against its own output does not duplicate labels', () => {
    const parsed = parseIntakeFormBody(formBody({ priority: 'high', size: 'L', dependsOn: '#7' }));
    const first = computeLabelsToApply(parsed, []);
    const second = computeLabelsToApply(parsed, first);
    expect(second.sort()).toEqual(first.sort());
    // no duplicates
    expect(new Set(second).size).toBe(second.length);
  });

  it('replaces stale priority/size/blocked_by labels on re-edit rather than accumulating', () => {
    const parsed = parseIntakeFormBody(formBody({ priority: 'low', size: 'S' }));
    const result = computeLabelsToApply(parsed, ['priority:high', 'size:L', 'blocked_by:#9', 'keep-me']);
    expect(result).toContain('priority:low');
    expect(result).toContain('size:S');
    expect(result).not.toContain('priority:high');
    expect(result).not.toContain('size:L');
    expect(result).not.toContain('blocked_by:#9');
    expect(result).toContain('keep-me');
  });

  it('preserves unrelated existing labels untouched', () => {
    const parsed = parseIntakeFormBody(formBody({ priority: 'medium', size: 'M' }));
    const result = computeLabelsToApply(parsed, ['area:daemon', 'good-first-issue']);
    expect(result).toContain('area:daemon');
    expect(result).toContain('good-first-issue');
  });
});
