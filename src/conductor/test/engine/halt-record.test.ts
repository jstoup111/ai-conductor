import { describe, expect, it } from 'vitest';
import {
  HALT_RECORD_DIR,
  haltRecordPath,
  renderHaltRecord,
} from '../../src/engine/halt-record.js';

const input = {
  slug: 'operator-decision',
  haltClass: 'needs-human',
  step: 'build_review',
  phase: 'BUILD',
  branch: 'feat/operator-decision',
  headSha: 'f00dbabe1234567890',
  haltedAt: '2026-08-23T16:30:00.000Z',
  haltBody: 'Build review needs an operator decision.\nThe release note scope is unclear.',
} as const;

describe('halt record rendering', () => {
  it('renders every operator pickup field for a halted feature', () => {
    expect(renderHaltRecord(input)).toBe(
      '# Halt record\n\n' +
        'Status: halted\n' +
        'Slug: operator-decision\n' +
        'Class: needs-human\n' +
        'Halting step: build_review\n' +
        'Phase: BUILD\n' +
        'Branch: feat/operator-decision\n' +
        'Head SHA: f00dbabe1234567890\n' +
        'Halted at: 2026-08-23T16:30:00.000Z\n\n' +
        '## HALT\n\n' +
        '```text\n' +
        'Build review needs an operator decision.\nThe release note scope is unclear.\n' +
        '```\n',
    );
  });

  it('uses a fence that preserves a HALT body containing a fence delimiter', () => {
    const haltBody = 'first line\n```\nembedded delimiter\n````';
    const record = renderHaltRecord({ ...input, haltBody });

    expect(record).toContain(`\`\`\`\`\`text\n${haltBody}\n\`\`\`\`\``);
  });

  it('is byte-identical for identical input and resolves the record path', () => {
    const first = renderHaltRecord(input);
    const second = renderHaltRecord(input);

    expect(first).toBe(second);
    expect(haltRecordPath(input.slug)).toBe(`${HALT_RECORD_DIR}/operator-decision.md`);
  });
});
