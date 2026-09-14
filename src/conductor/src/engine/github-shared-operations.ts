/**
 * Entry point for the closed set of existing shared GitHub administration
 * operations. Shared resources have no feature owner, so feature provenance
 * is never an authorization path here.
 */

import {
  decodeGithubOperationRequest,
  executeGithubOperation,
  type GithubOperationDecodeResult,
  type GithubOperationResult,
} from './github-operations.js';
import { requestExplicitGithubOperationApproval } from './github-operation-approval.js';
import { createGuardedGithubOperationRunner, type GhRunner } from './tracker-client.js';

export interface SharedGithubOperationExecutionOptions {
  readonly cwd: string;
  /** Only an interactive positive response can mint the exact approval. */
  readonly confirmation?: unknown;
}

export type SharedGithubOperationResult = GithubOperationResult
  | Extract<GithubOperationDecodeResult, { readonly kind: 'refused' }>;

/**
 * Resolve the canonical target before prompting, bind approval to that exact
 * request, then execute at the guarded `gh` transport seam.
 */
export async function executeSharedGithubOperation(
  value: unknown,
  transport: GhRunner,
  options: SharedGithubOperationExecutionOptions,
): Promise<SharedGithubOperationResult> {
  const decoded = decodeGithubOperationRequest(value);
  if (decoded.kind === 'refused') return decoded;
  if (decoded.request.access !== 'shared-write') {
    return {
      kind: 'refused',
      operation: decoded.request.operation,
      reason: 'unsupported-operation',
    };
  }

  const approval = await requestExplicitGithubOperationApproval(decoded.request, options.confirmation);
  if (approval.kind === 'refused') return approval;

  return executeGithubOperation(value, createGuardedGithubOperationRunner(transport, {
    cwd: options.cwd,
    shared: { approval: approval.capability },
  }));
}
