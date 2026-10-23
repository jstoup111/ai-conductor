// Covers: task:9
import { describe, expect, it } from 'vitest';

import {
  checkChildBodyPostconditions,
  renderChildBody,
  type ChildBodyMember,
} from '../../src/engine/stack-member-body.js';

const template = [
  '<!-- ai-conductor:step release-disposition -->',
  'Release-Disposition: no-note',
  '',
  '## Migration',
  '',
  'none',
  '<!-- /ai-conductor:step -->',
].join('\n');

const members: readonly ChildBodyMember[] = [
  { position: 1, name: 'child 1', reference: '#c1' },
  { position: 3, name: 'child 3', reference: '#c3' },
  { position: 5, name: 'leaf', reference: '#500' },
];

describe('stack member body', () => {
  it('renders the child-owned summary, diffstat, navigation, and template defaults', () => {
    const body = renderChildBody({
      slice: { position: 1, name: 'Foundation', taskIds: ['T1'], storyIds: ['S-A', 'S-B'] },
      stories: [
        { id: 'S-A', title: 'Create foundation' },
        { id: 'S-B', title: 'Verify the foundation' },
      ],
      branch: 'feat/c1/demo',
      base: 'main',
      diffstat: '2 files changed, 10 insertions(+)',
      members,
      template,
    });

    expect(body).toBe([
      '# Foundation',
      '',
      '## Summary',
      '',
      '- Story S-A: Create foundation',
      '- Story S-B: Verify the foundation',
      '- Task T1',
      '',
      '## Diffstat',
      '',
      'feat/c1/demo against main',
      '',
      '```text',
      '2 files changed, 10 insertions(+)',
      '```',
      '',
      '## Stack',
      '',
      '- #c1 (current)',
      '- #c3',
      '- #500',
      '',
      template,
    ].join('\n'));
  });

  it('rewrites plan paths in child-owned prose to their stems using reconcile grammar', () => {
    const body = renderChildBody({
      slice: { position: 1, name: 'Foundation', taskIds: ['T1'], storyIds: ['S-A'] },
      stories: [{ id: 'S-A', title: 'Implement .docs/plans/demo-plan.md exactly' }],
      branch: 'feat/c1/demo',
      base: 'main',
      diffstat: '1 file changed',
      members,
      template,
    });

    expect(body).toContain('Implement demo-plan exactly');
    expect(body).not.toMatch(/\.docs\/plans\/([^/\s`]+)\.md(?![A-Za-z0-9_.-])/);
  });

  it('omits project-owned regions when the project has no template', () => {
    const body = renderChildBody({
      slice: { position: 1, name: 'Foundation', taskIds: ['T1'], storyIds: [] },
      stories: [],
      branch: 'feat/c1/demo',
      base: 'main',
      diffstat: '1 file changed',
      members,
    });

    expect(body).toContain('# Foundation');
    expect(body).toContain('feat/c1/demo against main');
    expect(body).toContain('## Stack');
    expect(body).not.toContain('<!-- ai-conductor:step');
    expect(body).not.toContain('Release-Disposition');
  });

  it('refuses named members that carry closing references or altered defaults', () => {
    expect(checkChildBodyPostconditions(
      '## Summary\n\nCloses jstoup111/ai-conductor#2945',
      template,
      members[0],
    )).toEqual({ ok: false, reason: 'child 1: body contains an issue-closing reference' });

    expect(checkChildBodyPostconditions(
      template.replace('Release-Disposition: no-note', 'Release-Disposition: note'),
      template,
      members[0],
    )).toEqual({ ok: false, reason: 'child 1: project-owned region "release-disposition" differs from its template default' });
  });
});
