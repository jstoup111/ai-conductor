// Covers: task:6
// Filing-boundary coverage for the no-overlap decision gate. The creation
// runner is a deterministic fake so no GitHub operation reaches a process.

import { describe, expect, it } from 'vitest';

import {
  fileIntakeIssue,
  type FileIntakeIssueDeps,
} from '../../src/engine/engineer/intake/file-issue.js';
import { renderIntakeFileOutput } from '../../src/engine/engineer/intake/filing-output.js';
import type { GithubOperationRequest } from '../../src/engine/github-operations.js';

function filing(overlap?: FileIntakeIssueDeps['overlap'], onPrompt?: () => void) {
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
    ...(overlap ? { overlap } : {}),
    ...(onPrompt ? { prompt: async () => { onPrompt(); return 'ignored'; } } : {}),
  };

  return {
    operations,
    file: (interactive: boolean) => fileIntakeIssue({
      title: 'Evidence needs review',
      body: 'See src/review/rubric.ts',
      size: 'S',
      priority: 'low',
      interactive,
    }, deps),
  };
}

describe('fileIntakeIssue overlap decision gate', () => {
  it('keeps no-overlap creation operations and output unchanged apart from its check line', async () => {
    const withoutCheck = filing();
    const withCheck = filing({ suggestions: async () => ({ shown: [], preAccepted: [], advisory: [] }) });

    const baseline = await withoutCheck.file(false);
    const checked = await withCheck.file(false);
    const baselineOutput = renderIntakeFileOutput(baseline);
    const checkedOutput = renderIntakeFileOutput(checked);

    expect({
      operations: withCheck.operations,
      prompted: false,
      decision: checked.overlap,
      output: checkedOutput,
    }).toEqual({
      operations: withoutCheck.operations,
      prompted: false,
      decision: {
        kind: 'proceed', accepted: [], declined: [], advisory: [], skipNotes: [], omittedCount: 0,
      },
      output: {
        stdout: `${baselineOutput.stdout}[intake-file] overlap check: no overlap\n`,
        stderr: baselineOutput.stderr,
        exitCode: 0,
      },
    });
  });

  it.each([true, false])('does not prompt or change operations when no overlap exists (interactive=%s)', async (interactive) => {
    const withoutCheck = filing();
    let prompts = 0;
    const withCheck = filing(
      { suggestions: async () => ({ shown: [], preAccepted: [], advisory: [] }) },
      () => { prompts++; },
    );

    const baseline = await withoutCheck.file(interactive);
    const checked = await withCheck.file(interactive);

    expect({ operations: withCheck.operations, prompts, decision: checked.overlap?.kind }).toEqual({
      operations: withoutCheck.operations,
      prompts: 0,
      decision: 'proceed',
    });
    expect(renderIntakeFileOutput(checked).stdout).toContain('[intake-file] dependencies: none');
    expect(baseline.ok).toBe(true);
  });
});
