// Covers: task:7
// Filing-boundary coverage for overlap suggestions that the filer already
// named as dependencies. The creation runner is deterministic and does not
// reach GitHub.

import { describe, expect, it } from 'vitest';

import {
  fileIntakeIssue,
  type FileIntakeIssueDeps,
} from '../../src/engine/engineer/intake/file-issue.js';
import { renderIntakeFileOutput } from '../../src/engine/engineer/intake/filing-output.js';
import type { GithubOperationRequest } from '../../src/engine/github-operations.js';

const named = 'acme/app#1579';
const other = 'acme/app#1487';

function filing(suggestions: Awaited<ReturnType<NonNullable<FileIntakeIssueDeps['overlap']>['suggestions']>>) {
  const operations: GithubOperationRequest[] = [];
  const deps: FileIntakeIssueDeps = {
    creation: {
      authority: {
        resolveActor: async () => ({ resolved: true as const, id: 'alice' }),
        intent: { kind: 'explicit-intake', repository: 'acme/app' },
      },
      operations: {
        async run(request) {
          operations.push(request);
          if (request.operation === 'issue.create') {
            return { created: { repository: 'acme/app', kind: 'issue' as const, number: 300 } };
          }
          return {};
        },
      },
    },
    overlap: { suggestions: async () => suggestions },
  };

  return {
    operations,
    file: () => fileIntakeIssue({
      title: 'Evidence needs review',
      body: 'See src/review/rubric.ts',
      size: 'S',
      priority: 'low',
      dependsOn: [named],
      interactive: false,
    }, deps),
  };
}

describe('fileIntakeIssue pre-accepted overlap suggestions', () => {
  it('links a named overlapping dependency once without showing it as a suggestion', async () => {
    const subject = filing({
      shown: [],
      preAccepted: [{ issue: named, sharedPaths: ['src/review/rubric.ts'] }],
      advisory: [],
    });

    const result = await subject.file();
    const dependencies = subject.operations.filter(({ operation }) => operation === 'issue.dependency.add');
    const output = renderIntakeFileOutput(result);

    expect(dependencies).toHaveLength(1);
    expect(dependencies[0]?.payload).toEqual({
      dependency: { repository: 'acme/app', kind: 'issue', number: 1579 },
    });
    expect(output.stdout).not.toContain(`[intake-file] overlap: undecided ${named}`);
  });

  it('proceeds non-interactively and creates the issue when its only overlap is already named', async () => {
    const subject = filing({
      shown: [],
      preAccepted: [{ issue: named, sharedPaths: ['src/review/rubric.ts'] }],
      advisory: [],
    });

    const result = await subject.file();

    expect(result.ok).toBe(true);
    expect(result.overlap).toMatchObject({ kind: 'proceed', accepted: [] });
    expect(subject.operations.filter(({ operation }) => operation === 'issue.create')).toHaveLength(1);
  });

  it('refuses non-interactive filing with only the unnamed overlap undecided', async () => {
    const subject = filing({
      shown: [{ issue: other, sharedPaths: ['src/halt/markers.ts'] }],
      preAccepted: [{ issue: named, sharedPaths: ['src/review/rubric.ts'] }],
      advisory: [],
    });

    const result = await subject.file();

    expect(result.ok).toBe(false);
    expect(result.overlap).toEqual({
      kind: 'refused',
      undecided: [{ issue: other, sharedPaths: ['src/halt/markers.ts'] }],
      advisory: [],
      skipNotes: [],
      omittedCount: 0,
    });
    expect(subject.operations.filter(({ operation }) => operation === 'issue.create')).toHaveLength(0);
  });
});
