// github-operation-approval.ts — exact, interactive approval for non-feature GitHub writes.
//
// Explicit approval is deliberately a one-request capability, not an operator
// name or a bypass flag. Its private binding is checked again at the guarded
// execution boundary before it can authorize a write.

import { createHash } from 'node:crypto';

import type {
  GithubOperationName,
  GithubOperationPayload,
  GithubOperationRequest,
  GithubOperationTarget,
} from './github-operations.js';
import { normalizeOwnerId } from './owner-gate/identity.js';

declare const explicitApprovalBrand: unique symbol;

/**
 * An opaque, process-local proof minted only by positive interactive approval.
 * The brand prevents normal construction at compile time; the private WeakMap
 * prevents a structurally forged object from passing at runtime.
 */
export interface GithubExplicitOperationApproval {
  readonly [explicitApprovalBrand]: 'github-explicit-operation-approval';
}

export interface GithubOperationApprovalPrompt {
  readonly actor: string;
  readonly repository: string;
  readonly target: GithubOperationTarget;
  readonly operation: GithubOperationName;
  readonly payloadDigest: string;
}

/** The adapter is intentionally interactive; daemon/automatic sources cannot approve writes. */
export interface InteractiveGithubOperationConfirmation {
  readonly mode: 'interactive';
  confirm(prompt: GithubOperationApprovalPrompt): Promise<boolean>;
}

export type GithubOperationApproval =
  | {
    readonly kind: 'approved';
    readonly actor: string;
    readonly operation: GithubOperationName;
    readonly target: GithubOperationTarget;
    readonly payloadDigest: string;
    readonly capability: GithubExplicitOperationApproval;
  }
  | {
    readonly kind: 'refused';
    readonly operation: GithubOperationName;
    readonly target: GithubOperationTarget;
    readonly reason: 'explicit-authorization-required';
  };

interface ApprovalBinding {
  readonly actor: string;
  readonly repository: string;
  readonly target: GithubOperationTarget;
  readonly operation: GithubOperationName;
  readonly payloadDigest: string;
}

const approvalBindings = new WeakMap<object, ApprovalBinding>();

function boundTarget(target: GithubOperationTarget): GithubOperationTarget {
  switch (target.kind) {
    case 'issue':
    case 'pull-request':
      return Object.freeze({ repository: target.repository, kind: target.kind, number: target.number });
    case 'label-definition':
      return Object.freeze({ repository: target.repository, kind: target.kind, name: target.name });
    case 'remote-ref':
      return Object.freeze({ repository: target.repository, kind: target.kind, ref: target.ref });
    case 'repository':
      return Object.freeze({ repository: target.repository, kind: target.kind });
  }
}

function targetsMatch(left: GithubOperationTarget, right: GithubOperationTarget): boolean {
  if (left.repository !== right.repository || left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'issue':
    case 'pull-request':
      return right.kind === left.kind && right.number === left.number;
    case 'label-definition':
      return right.kind === 'label-definition' && right.name === left.name;
    case 'remote-ref':
      return right.kind === 'remote-ref' && right.ref === left.ref;
    case 'repository':
      return true;
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

/** Hash the canonical payload presentation shown to the approving operator. */
export function githubOperationPayloadDigest(payload: GithubOperationPayload | undefined): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(payload ?? null))).digest('hex')}`;
}

function bindingFor(request: GithubOperationRequest): ApprovalBinding | undefined {
  const actor = normalizeOwnerId(request.context.actor);
  if (actor === null) return undefined;
  const target = boundTarget(request.target);
  return Object.freeze({
    actor,
    repository: target.repository,
    target,
    operation: request.operation,
    payloadDigest: githubOperationPayloadDigest(request.payload),
  });
}

function refused(request: GithubOperationRequest): GithubOperationApproval {
  return Object.freeze({
    kind: 'refused',
    operation: request.operation,
    target: boundTarget(request.target),
    reason: 'explicit-authorization-required',
  });
}

function interactiveConfirmation(value: unknown): value is InteractiveGithubOperationConfirmation {
  return value !== null
    && typeof value === 'object'
    && (value as { mode?: unknown }).mode === 'interactive'
    && typeof (value as { confirm?: unknown }).confirm === 'function';
}

/**
 * Only pre-spec intake, shared-resource, and initial-publication writes may
 * obtain this authority. A remote-ref push reaches this path only when the
 * CLI could not resolve owned feature provenance; the remote adapter checks
 * the same opaque, exact-request capability again before transport.
 */
function requiresExplicitApproval(request: GithubOperationRequest): boolean {
  return request.access === 'intake-write'
    || request.access === 'shared-write'
    || (request.access === 'remote-ref-write' && request.operation === 'remote-ref.push');
}

/**
 * Present one canonical request to an interactive operator. A positive answer
 * mints one opaque capability; missing, declined, failed, or noninteractive
 * confirmation remains a typed refusal. Initial publication remains bound to
 * the same actor, repository, ref, operation, and payload as every other
 * approved request; it cannot become repository-wide authority.
 */
export async function requestExplicitGithubOperationApproval(
  request: GithubOperationRequest,
  confirmation?: unknown,
): Promise<GithubOperationApproval> {
  const binding = bindingFor(request);
  if (!binding || !requiresExplicitApproval(request) || !interactiveConfirmation(confirmation)) {
    return refused(request);
  }

  const prompt = Object.freeze({
    actor: binding.actor,
    repository: binding.repository,
    target: binding.target,
    operation: binding.operation,
    payloadDigest: binding.payloadDigest,
  });
  let confirmed = false;
  try {
    confirmed = await confirmation.confirm(prompt) === true;
  } catch {
    // A failed prompt is not an affirmative authorization.
  }
  if (!confirmed) return refused(request);

  const capability = Object.freeze({}) as GithubExplicitOperationApproval;
  approvalBindings.set(capability, binding);
  return Object.freeze({
    kind: 'approved',
    actor: binding.actor,
    operation: binding.operation,
    target: binding.target,
    payloadDigest: binding.payloadDigest,
    capability,
  });
}

/**
 * Validate the hidden one-request binding. Visible result fields, arbitrary
 * objects, owner strings, and ignore flags never appear in the WeakMap.
 */
export function hasExplicitGithubOperationApproval(
  capability: unknown,
  request: GithubOperationRequest,
): capability is GithubExplicitOperationApproval {
  if (capability === null || (typeof capability !== 'object' && typeof capability !== 'function')) return false;
  const approved = approvalBindings.get(capability);
  const attempted = bindingFor(request);
  return approved !== undefined
    && attempted !== undefined
    && approved.actor === attempted.actor
    && approved.repository === attempted.repository
    && approved.operation === attempted.operation
    && approved.payloadDigest === attempted.payloadDigest
    && targetsMatch(approved.target, attempted.target);
}
