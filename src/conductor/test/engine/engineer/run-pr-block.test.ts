// Covers: task:6
import { describe, expect, it, vi } from 'vitest';
import { renderRunBlock, upsertRunBlock } from '../../../src/engine/engineer/run-pr-block.js';
import { resumeComposerRun } from '../../../src/engine/engineer/resume.js';
import type { RunRecord } from '../../../src/engine/engineer/run-record.js';

const record: RunRecord = { schemaVersion: 1, slug: 'demo', steps: { explore: { state: 'accepted', actor: 'A', provider: 'codex', at: '2026-11-08T00:00:00.000Z', artifacts: [] }, prd: { state: 'draft' } }, needsReconfirm: [], ownerHistory: [], notes: { explore: { decisions: ['technical'], openQuestions: ['Which API?'] } } };

describe('Composer PR run block', () => {
  it('Covers: Task 6 renders every Composer summary field from the durable record', () => {
    const rendered = renderRunBlock(record);
    expect(rendered).toContain('Current step: prd');
    expect(rendered).toContain('Active provider: codex');
    expect(rendered).toContain('Last actor: A at 2026-11-08T00:00:00.000Z');
    expect(rendered).toContain('explore: accepted by A via codex at 2026-11-08T00:00:00.000Z');
    expect(rendered).toContain('Which API?');
    expect(rendered).toContain('Next step: prd');
  });
  it('replaces only the marker-delimited region', () => {
    const body = 'Intro\n\n## Release metadata\n\nRelease-Disposition: no-note\n\nRefs o/r#1';
    const once = upsertRunBlock(body, renderRunBlock(record));
    expect(once).toContain(body);
    expect(upsertRunBlock(once, 'x')).toBe(`${body}\n\nx`);
  });

  it('Covers: Task 6 saves on a refresh warning and retries the PR edit at the next checkpoint', async () => {
    const { checkpointComposerRun } = await import('../../../src/engine/engineer/checkpoint.js');
    const edit = vi.fn(async () => { throw new Error('rate limited'); });
    const git = async (args: readonly string[]) => ({ exitCode: args[0] === 'diff' ? 1 : 0, stdout: args[0] === 'branch' ? 'spec/demo\n' : args[0] === 'status' ? '?? .docs/track/demo.md' : '', stderr: '' });
    const fs = { readFile: async (path: string) => path.endsWith('demo.md') ? '# demo\n' : (() => { throw new Error('ENOENT'); })(), writeFile: async () => {}, mkdir: async () => {} };
    const deps: any = { git, fs, resolveOwner: async () => ({ resolved: true, id: 'A' }), writeMarker: async () => {}, emit: async () => {}, publication: { push: async () => {}, findOpenPullRequest: async () => ({ url: 'https://github.com/o/r/pull/1', body: 'intro' }), createDraftPullRequest: async () => ({ url: '', body: '' }), editPullRequest: edit } };
    const first = await checkpointComposerRun({ worktree: '/worktree', step: 'explore', state: 'accepted' }, deps);
    const second = await checkpointComposerRun({ worktree: '/worktree', step: 'explore', state: 'accepted' }, deps);
    expect(first).toMatchObject({ published: true, warnings: [expect.stringMatching(/saved.*retry/i)] });
    expect(second.published).toBe(true);
    expect(edit).toHaveBeenCalledTimes(2);
  });

  it('Covers: Task 6 ignores a hand-edited PR block when it resumes from the durable run record', async () => {
    const handEditedBody = upsertRunBlock('Release-Disposition: no-note', '<!-- ai-conductor:composer-run:start -->\nCurrent step: delivery\n<!-- ai-conductor:composer-run:end -->');
    expect(handEditedBody).toContain('Current step: delivery');
    const resumed = await resumeComposerRun('spec/demo', { attach: async () => ({ worktree: '/tmp/demo' }), readRunRecord: async () => JSON.stringify(record), resolveBranch: async () => undefined });
    expect(resumed.context).toMatchObject({ nextStep: 'prd', decisions: ['technical'], openQuestions: ['Which API?'] });
  });
});
