// Covers: task:11
import { describe, expect, it } from 'vitest';
import { fileIntakeIssue } from '../../src/engine/engineer/intake/file-issue.js';
import { renderIntakeFileOutput } from '../../src/engine/engineer/intake/filing-output.js';
import type { FileIntakeIssueResult } from '../../src/engine/engineer/intake/file-issue.js';
import type { GithubOperationRequest } from '../../src/engine/github-operations.js';

const acceptedRef = 'acme/app#1579';

async function fileWithFailedDependency(acceptedByOverlap: boolean): Promise<FileIntakeIssueResult> {
  return fileIntakeIssue({
    title: 't', body: 'src/a.ts', size: 'S', priority: 'low', interactive: acceptedByOverlap,
    ...(acceptedByOverlap ? {} : { dependsOn: [acceptedRef] }),
  }, {
    ...(acceptedByOverlap ? {
      prompt: async () => 'accept',
      overlap: { suggestions: async () => ({
        shown: [{ issue: acceptedRef, sharedPaths: ['src/a.ts'] }], preAccepted: [], advisory: [],
      }) },
    } : {}),
    creation: {
      authority: {
        resolveActor: async () => ({ resolved: true as const, id: 'alice' }),
        intent: { kind: 'explicit-intake', repository: 'acme/app' },
      },
      operations: {
        run: async (request: GithubOperationRequest) => {
          if (request.operation === 'issue.create') {
            return { created: { repository: 'acme/app', kind: 'issue' as const, number: 1 } };
          }
          if (request.operation === 'issue.dependency.add') {
            return { kind: 'refused' as const, reason: 'explicit-authorization-required' as const };
          }
          return {};
        },
      },
    },
  });
}

describe('declined overlap output', () => {
  it('reports linked and declined suggestions without changing dependency output', () => {
    const result: FileIntakeIssueResult = { ok: true, issueUrl: 'https://github.com/acme/app/issues/1', size: 'S', priority: 'low', sizeSource: 'given', prioritySource: 'given', dependsOnDecision: 'none', linked: [acceptedRef], unlinked: [], badRefs: [], warnings: [], metadataFailures: [], redactions: [], overlap: { kind: 'proceed', accepted: [acceptedRef], declined: ['acme/app#1487'], advisory: [], skipNotes: [], omittedCount: 3 } };
    expect(renderIntakeFileOutput(result).stdout).toContain(`[intake-file] overlap: linked ${acceptedRef}`);
    expect(renderIntakeFileOutput(result).stdout).toContain('[intake-file] overlap: declined acme/app#1487');
    expect(renderIntakeFileOutput(result).stdout).toContain('[intake-file] overlap: 3 more suggestion(s) omitted');
  });

  it('reports an accepted dependency-link failure exactly as an up-front dependency failure', async () => {
    const accepted = await fileWithFailedDependency(true);
    const upfront = await fileWithFailedDependency(false);
    const output = renderIntakeFileOutput(accepted);

    expect(accepted.metadataFailures).toEqual(upfront.metadataFailures);
    expect(accepted.warnings).toEqual(upfront.warnings);
    expect(output.stdout).not.toContain(`[intake-file] overlap: linked ${acceptedRef}`);
    expect(output.stderr).toContain(`[intake-file] NOT LINKED: ${accepted.issueUrl} is not blocked by ${acceptedRef}`);
  });
});
