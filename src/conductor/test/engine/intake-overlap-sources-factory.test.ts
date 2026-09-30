// Covers: task:21
import { describe, expect, it } from 'vitest';
import { buildOverlapSources } from '../../src/engine/engineer/intake/overlap-preflight.js';

describe('target-scoped overlap source factory', () => {
  it('skips in-flight scanning when no target checkout can be resolved', async () => {
    const suggestions = buildOverlapSources({ cwd: '/definitely/not-a-checkout', repository: 'acme/widgets', gh: async () => ({ exitCode: 0, stdout: '[]', stderr: '' }), registryReader: { listProjects: async () => [], getProject: async () => undefined } });
    const result = await suggestions({ title: 't', body: 'src/a.ts', dependsOn: [], interactive: false });
    expect(result.skipNotes).toEqual([{ part: 'in-flight', reason: 'no-match' }]);
  });

  it('keeps the tracker read independent when registry resolution throws', async () => {
    const suggestions = buildOverlapSources({
      cwd: '/definitely/not-a-checkout', repository: 'acme/widgets',
      gh: async () => { throw new Error('tracker unavailable'); },
      registryReader: {
        listProjects: async () => { throw new Error('malformed registry'); },
        getProject: async () => undefined,
      },
    });
    const result = await suggestions({ title: 't', body: 'src/a.ts', dependsOn: [], interactive: false });
    expect(result.skipNotes).toContainEqual({ part: 'in-flight', reason: 'malformed registry' });
    expect(result.skipNotes).toContainEqual(expect.objectContaining({ part: 'open-issues', reason: expect.stringContaining('tracker unavailable') }));
  });
});
