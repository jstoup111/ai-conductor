// Covers: task:8
import { createInterface } from 'node:readline/promises';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { promptReadlineQuestion } from '../../src/intake-file-cli.js';
import { fileIntakeIssue } from '../../src/engine/engineer/intake/file-issue.js';
import { renderIntakeFileOutput } from '../../src/engine/engineer/intake/filing-output.js';
import type { GithubOperationRequest } from '../../src/engine/github-operations.js';
import { runOverlapPreflight } from '../../src/engine/engineer/intake/overlap-preflight.js';

describe('interactive overlap decisions', () => {
  it('re-asks invalid answers and records acceptance and decline', async () => {
    const answers = ['maybe', 'accept', 'd']; let calls = 0;
    const result = await runOverlapPreflight({ title: 't', body: 'b', dependsOn: [], interactive: true,
      prompt: async () => { calls++; return answers.shift()!; } }, { suggestions: async () => ({
      shown: [{ issue: 'acme/app#1579', sharedPaths: ['a.ts'] }, { issue: 'acme/app#1487', sharedPaths: ['b.ts'] }], preAccepted: [], advisory: [],
    }) });
    expect({ result, calls }).toEqual({ result: { kind: 'proceed', accepted: ['acme/app#1579'], declined: ['acme/app#1487'], advisory: [], skipNotes: [], omittedCount: 0 }, calls: 3 });
  });

  it('files accepted suggestions as dependencies, leaves declined suggestions unlinked, and renders advisory overlaps without prompting', async () => {
    const operations: GithubOperationRequest[] = [];
    let prompts = 0;
    const result = await fileIntakeIssue({ title: 't', body: 'b', size: 'S', priority: 'low', interactive: true }, {
      prompt: async () => {
        prompts++;
        return prompts === 1 ? 'accept' : 'decline';
      },
      overlap: { suggestions: async () => ({
        shown: [{ issue: 'acme/app#1579', sharedPaths: ['a.ts'] }, { issue: 'acme/app#1487', sharedPaths: ['b.ts'] }],
        preAccepted: [],
        advisory: [{ branch: 'feat/daemon-advisory', issue: null, sharedPaths: ['c.ts'] }],
      }) },
      creation: {
        authority: { resolveActor: async () => ({ resolved: true as const, id: 'alice' }), intent: { kind: 'explicit-intake', repository: 'acme/app' } },
        operations: { run: async (request) => {
          operations.push(request);
          return request.operation === 'issue.create'
            ? { created: { repository: 'acme/app', kind: 'issue' as const, number: 1 } }
            : {};
        } },
      },
    });

    expect(operations.filter(({ operation }) => operation === 'issue.create')).toHaveLength(1);
    expect(operations.filter(({ operation }) => operation === 'issue.dependency.add')).toEqual([
      expect.objectContaining({ payload: { dependency: { repository: 'acme/app', kind: 'issue', number: 1579 } } }),
    ]);
    expect(result.overlap).toMatchObject({ kind: 'proceed', declined: ['acme/app#1487'] });
    expect(renderIntakeFileOutput(result).stdout).toContain('[intake-file] overlap: advisory feat/daemon-advisory (c.ts)');

    const advisoryOnly = await runOverlapPreflight({ title: 't', body: 'b', dependsOn: [], interactive: true,
      prompt: async () => { throw new Error('advisory overlaps must not prompt'); } }, { suggestions: async () => ({
      shown: [], preAccepted: [], advisory: [{ branch: 'feat/daemon-advisory', issue: null, sharedPaths: ['c.ts'] }],
    }) });
    expect(advisoryOnly).toMatchObject({ kind: 'proceed', advisory: [{ branch: 'feat/daemon-advisory', sharedPaths: ['c.ts'] }] });

    const namedOperations: GithubOperationRequest[] = [];
    await fileIntakeIssue({ title: 't', body: 'b', size: 'S', priority: 'low', dependsOn: ['acme/app#1579'] }, {
      creation: {
        authority: { resolveActor: async () => ({ resolved: true as const, id: 'alice' }), intent: { kind: 'explicit-intake', repository: 'acme/app' } },
        operations: { run: async (request) => {
          namedOperations.push(request);
          return request.operation === 'issue.create'
            ? { created: { repository: 'acme/app', kind: 'issue' as const, number: 2 } }
            : {};
        } },
      },
    });
    expect(operations.find(({ operation }) => operation === 'issue.dependency.add')?.payload)
      .toEqual(namedOperations.find(({ operation }) => operation === 'issue.dependency.add')?.payload);
  });

  it('refuses when a real readline prompt closes before every suggestion is answered', async () => {
    const input = new PassThrough();
    const rl = createInterface({ input, output: new PassThrough() });
    const operations: GithubOperationRequest[] = [];
    let markFirstPrompt: () => void;
    const firstPrompt = new Promise<void>((resolvePrompt) => { markFirstPrompt = resolvePrompt; });
    const resultPromise = fileIntakeIssue({ title: 't', body: 'b', size: 'S', priority: 'low', interactive: true }, {
      prompt: (question) => {
        const answer = promptReadlineQuestion(rl, question);
        markFirstPrompt();
        return answer;
      },
      overlap: { suggestions: async () => ({
        shown: [{ issue: 'acme/app#1579', sharedPaths: ['a.ts'] }, { issue: 'acme/app#1487', sharedPaths: ['b.ts'] }],
        preAccepted: [], advisory: [],
      }) },
      creation: {
        authority: { resolveActor: async () => ({ resolved: true as const, id: 'alice' }), intent: { kind: 'explicit-intake', repository: 'acme/app' } },
        operations: { run: async (request) => {
          operations.push(request);
          return request.operation === 'issue.create'
            ? { created: { repository: 'acme/app', kind: 'issue' as const, number: 1 } }
            : {};
        } },
      },
    });
    await firstPrompt;
    input.write('accept\n');
    await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));
    input.end();
    const result = await resultPromise;

    expect(operations.filter(({ operation }) => operation === 'issue.create')).toHaveLength(0);
    expect(result.overlap).toMatchObject({ kind: 'refused', undecided: [{ issue: 'acme/app#1487' }] });
    expect(renderIntakeFileOutput(result)).toMatchObject({ exitCode: 1, stdout: expect.stringContaining('acme/app#1487') });
  });
});
