// Covers: task:11
import { describe, expect, it } from 'vitest';
import { renderIntakeFileOutput } from '../../src/engine/engineer/intake/filing-output.js';
import type { FileIntakeIssueResult } from '../../src/engine/engineer/intake/file-issue.js';

describe('declined overlap output', () => {
  it('reports linked and declined suggestions without changing dependency output', () => {
    const result: FileIntakeIssueResult = { ok: true, issueUrl: 'https://github.com/acme/app/issues/1', size: 'S', priority: 'low', sizeSource: 'given', prioritySource: 'given', dependsOnDecision: 'none', linked: [], unlinked: [], badRefs: [], warnings: [], metadataFailures: [], redactions: [], overlap: { kind: 'proceed', accepted: ['acme/app#1579'], declined: ['acme/app#1487'], advisory: [], skipNotes: [], omittedCount: 3 } };
    expect(renderIntakeFileOutput(result).stdout).toContain('[intake-file] overlap: declined acme/app#1487');
    expect(renderIntakeFileOutput(result).stdout).toContain('[intake-file] overlap: 3 more suggestion(s) omitted');
  });
});
