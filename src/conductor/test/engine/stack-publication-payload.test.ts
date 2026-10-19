import { describe, expect, it, vi } from 'vitest';

import { decodeGithubOperationRequest } from '../../src/engine/github-operations.js';
import { validateStackPayload } from '../../src/engine/stack-publication.js';
import type { PublicationRecord } from '../../src/engine/stack-publication-record.js';

const record: PublicationRecord = {
  version: 1,
  stack: { number: 44, verified: false },
  members: [
    { position: 1 as never, branch: 'feat/c1/demo', pr: 101 },
    { position: 3 as never, branch: 'feat/c3/demo', pr: 103 },
    { position: 5 as never, branch: 'feat/daemon-demo', pr: 500 },
  ],
};

function request(value: Record<string, unknown>) {
  const decoded = decodeGithubOperationRequest({ repository: 'acme/owned', context: { actor: 'finish' }, ...value });
  if (decoded.kind === 'refused') throw new Error(`fixture did not decode: ${decoded.reason}`);
  return decoded.request;
}

describe('stack publication payload binding', () => {
  it('refuses unrecorded members and bases before an operation runner can be reached', async () => {
    const terminal = vi.fn(async () => ({}));
    const invalidCreate = request({ operation: 'stack.create', resource: { kind: 'repository' }, payload: { pullRequests: [101, 103, 999] } });
    const invalidBase = request({ operation: 'pull-request.retarget', resource: { kind: 'pull-request', number: 500 }, payload: { base: 'release-x' } });
    const wrongStack = request({ operation: 'stack.add', resource: { kind: 'stack', number: 45 }, payload: { pullRequests: [500] } });

    expect(validateStackPayload(record, invalidCreate)).toEqual({ kind: 'refused', reason: 'invalid-payload' });
    expect(validateStackPayload(record, invalidBase)).toEqual({ kind: 'refused', reason: 'invalid-payload' });
    expect(validateStackPayload(record, wrongStack)).toEqual({ kind: 'refused', reason: 'invalid-target' });
    expect(terminal).not.toHaveBeenCalled();

    // The test deliberately keeps the terminal seam outside the validation
    // branch: refused payloads never become executable requests.
  });

  it('accepts exactly the durable members, stack number and member base', () => {
    expect(validateStackPayload(record, request({
      operation: 'stack.create', resource: { kind: 'repository' }, payload: { pullRequests: [101, 103, 500] },
    }))).toEqual({ kind: 'valid' });
    expect(validateStackPayload(record, request({
      operation: 'stack.add', resource: { kind: 'stack', number: 44 }, payload: { pullRequests: [500] },
    }))).toEqual({ kind: 'valid' });
    expect(validateStackPayload(record, request({
      operation: 'pull-request.retarget', resource: { kind: 'pull-request', number: 500 }, payload: { base: 'feat/c3/demo' },
    }))).toEqual({ kind: 'valid' });
  });
});
