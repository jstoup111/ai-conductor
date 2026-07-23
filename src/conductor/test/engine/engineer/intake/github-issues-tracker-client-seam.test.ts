// Regression guard for Task 9 (canonical tracker-client seam migration).
// The github-issues adapter must route its poll-list / comment / label-add gh
// calls through tracker-client.ts's createGithubTrackerClient rather than
// hand-rolling duplicate argv literals. This is a structural check (not
// behavior — argv stays byte-identical, see github-issues.test.ts) that
// prevents the seam from silently drifting back to inline gh argv.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(
  join(__dirname, '../../../../src/engine/engineer/intake/github-issues.ts'),
  'utf8',
);

describe('github-issues adapter — tracker-client seam (Task 9)', () => {
  it('imports createGithubTrackerClient from the canonical seam', () => {
    expect(source).toMatch(/from ['"].*tracker-client\.js['"]/);
    expect(source).toMatch(/createGithubTrackerClient/);
  });

  it('does not hand-roll the assignee-scoped issue-list argv (delegates to listAssignedIssues)', () => {
    expect(source).not.toMatch(/'issue',\s*\n?\s*'list',\s*\n?\s*'--assignee'/);
  });
});
