import { describe, expect, it } from 'vitest';
import { contextForRun, parseResumeTarget, resumeComposerRun } from '../../../src/engine/engineer/resume.js';
import type { RunRecord } from '../../../src/engine/engineer/run-record.js';

const record: RunRecord = { schemaVersion: 1, slug: 'demo', steps: { explore: { state: 'accepted', actor: 'A', provider: 'codex', at: '2026-11-08T00:00:00.000Z', artifacts: [{ path: '.docs/track/demo.md', sha256: 'a'.repeat(64) }] }, prd: { state: 'accepted', actor: 'A', provider: 'codex', at: '2026-11-08T00:01:00.000Z', artifacts: [] }, architecture_diagram: { state: 'draft' } }, needsReconfirm: [], ownerHistory: [], notes: { explore: { decisions: ['technical'], openQuestions: ['why?'] } } };
describe('Composer resume', () => {
  it('parses PR, branch and intake targets', () => {
    expect(parseResumeTarget('17')).toEqual({ kind: 'pr', number: 17 });
    expect(parseResumeTarget('spec/demo')).toEqual({ kind: 'branch', branch: 'spec/demo' });
    expect(parseResumeTarget('o/r#17')).toEqual({ kind: 'intake', repository: 'o/r', number: 17 });
  });
  it('uses the record for the first unaccepted step and emits a resume transition', async () => {
    const emitted: unknown[] = [];
    const result = await resumeComposerRun('spec/demo', { attach: async () => ({ worktree: '/tmp/demo' }), readRunRecord: async () => JSON.stringify(record), resolveBranch: async () => undefined, emit: async (event) => { emitted.push(event); } });
    expect(result.context).toMatchObject({ nextStep: 'complexity', lastActor: 'A', decisions: ['technical'] });
    expect(emitted).toHaveLength(1);
    expect(contextForRun(record).drafts).toContain('architecture_diagram');
  });
});
