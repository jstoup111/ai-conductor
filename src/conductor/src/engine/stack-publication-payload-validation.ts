import type { GithubOperationRequest } from './github-operations.js';
import type { PublicationRecord } from './stack-publication-record.js';

export type StackPayloadValidation =
  | { readonly kind: 'valid' }
  | { readonly kind: 'refused'; readonly reason: 'invalid-payload' | 'invalid-target' };

/**
 * Bind native-stack payloads to their durable publication record without
 * depending on FINISH composition. Both the CLI and FINISH runners apply this
 * pure check before their respective transport boundaries.
 */
export function validateStackPayload(
  record: PublicationRecord,
  request: GithubOperationRequest,
): StackPayloadValidation {
  const memberNumbers = record.members.map((member) => member.pr);
  switch (request.operation) {
    case 'stack.read': {
      const payload = request.payload;
      return payload && 'pullRequest' in payload && typeof payload.pullRequest === 'number'
        && memberNumbers.includes(payload.pullRequest)
        ? { kind: 'valid' }
        : { kind: 'refused', reason: 'invalid-payload' };
    }
    case 'stack.create': {
      const payload = request.payload;
      if (!payload || !('pullRequests' in payload) || !Array.isArray(payload.pullRequests)) {
        return { kind: 'refused', reason: 'invalid-payload' };
      }
      const requested = payload.pullRequests;
      return requested.length === memberNumbers.length
        && requested.every((number, index) => number === memberNumbers[index])
        ? { kind: 'valid' }
        : { kind: 'refused', reason: 'invalid-payload' };
    }
    case 'stack.add': {
      if (record.stack === undefined || request.target.kind !== 'stack' || request.target.number !== record.stack.number) {
        return { kind: 'refused', reason: 'invalid-target' };
      }
      const payload = request.payload;
      if (!payload || !('pullRequests' in payload) || !Array.isArray(payload.pullRequests)
        || payload.pullRequests.some((number) => !memberNumbers.includes(number))) {
        return { kind: 'refused', reason: 'invalid-payload' };
      }
      return { kind: 'valid' };
    }
    case 'pull-request.retarget': {
      const member = record.members.find((candidate) => candidate.pr === (request.target.kind === 'pull-request' ? request.target.number : undefined));
      const payload = request.payload;
      return member !== undefined && payload && 'base' in payload && typeof payload.base === 'string'
        && record.members.some((candidate) => candidate.branch === payload.base)
        ? { kind: 'valid' }
        : { kind: 'refused', reason: 'invalid-payload' };
    }
    default:
      return { kind: 'valid' };
  }
}
