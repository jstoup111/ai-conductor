// Covers: task:6
import { describe, expect, it } from 'vitest';
import { renderRunBlock, upsertRunBlock } from '../../../src/engine/engineer/run-pr-block.js';
import type { RunRecord } from '../../../src/engine/engineer/run-record.js';

const record: RunRecord = { schemaVersion: 1, slug: 'demo', steps: { explore: { state: 'accepted', actor: 'A', provider: 'codex', at: '2026-11-08T00:00:00.000Z', artifacts: [] }, prd: { state: 'draft' } }, needsReconfirm: [], ownerHistory: [], notes: { explore: { decisions: ['technical'], openQuestions: ['Which API?'] } } };

describe('Composer PR run block', () => {
  it('renders the current run only from the durable record', () => {
    expect(renderRunBlock(record)).toContain('Current step: complexity');
    expect(renderRunBlock(record)).toContain('explore: accepted by A via codex');
    expect(renderRunBlock(record)).toContain('Which API?');
  });
  it('replaces only the marker-delimited region', () => {
    const body = 'Intro\n\n## Release metadata\n\nRelease-Disposition: no-note\n\nRefs o/r#1';
    const once = upsertRunBlock(body, renderRunBlock(record));
    expect(once).toContain(body);
    expect(upsertRunBlock(once, 'x')).toBe(`${body}\n\nx`);
  });
});
