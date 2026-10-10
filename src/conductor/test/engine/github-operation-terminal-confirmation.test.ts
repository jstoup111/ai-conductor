import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { createTerminalGithubOperationConfirmation } from '../../src/engine/github-operation-terminal-confirmation.js';

const closeIssuePrompt = {
  actor: 'machine-owner',
  repository: 'o/a',
  target: { repository: 'o/a', kind: 'issue' as const, number: 1 },
  operation: 'intake.issue.close' as const,
  payloadDigest: 'sha256:test',
};

function makeConfirmation(isTerminal: () => boolean) {
  const input = new PassThrough();
  const output = new PassThrough();
  let written = '';
  output.on('data', (chunk: Buffer) => {
    written += chunk.toString();
  });
  return {
    input,
    confirmation: createTerminalGithubOperationConfirmation({ input, output, isTerminal }),
    output: () => written,
  };
}

describe('createTerminalGithubOperationConfirmation', () => {
  it('refuses without writing when the streams are not attached to a terminal', async () => {
    const { confirmation, output } = makeConfirmation(() => false);

    await expect(confirmation.confirm(closeIssuePrompt)).resolves.toBe(false);

    expect(output()).toBe('');
  });

  it.each([
    ['y', true],
    ['yes', true],
    ['n', false],
    ['', false],
  ])('uses %j as the approval answer', async (answer, expected) => {
    const { confirmation, input, output } = makeConfirmation(() => true);

    const confirmed = confirmation.confirm(closeIssuePrompt);
    input.write(`${answer}\n`);

    await expect(confirmed).resolves.toBe(expected);
    expect(output()).toBe('Authorize intake.issue.close on o/a#1? [y/N] ');
  });
});
