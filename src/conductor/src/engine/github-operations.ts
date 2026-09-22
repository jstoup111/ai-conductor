import type {
  ConductorEvent,
  GithubOperationRefusalRemedy,
} from '../types/events.js';
import {
  resolveGithubTarget,
  type GithubTargetDiscovery,
  type GithubTargetInput,
} from './github-target.js';

/**
 * Closed request vocabulary for the GitHub and remote-Git guards.
 *
 * Callers supply operation data, never an access classification. The registry
 * owns that classification so an unknown operation cannot pose as a read.
 */

export type GithubOperationAccess =
  | 'read'
  | 'feature-write'
  | 'intake-write'
  | 'create'
  | 'shared-write'
  | 'remote-ref-write';

export type GithubResourceKind =
  | 'issue'
  | 'pull-request'
  | 'label-definition'
  | 'remote-ref'
  | 'repository';

interface GithubRepositoryTarget {
  readonly repository: string;
  readonly kind: 'repository';
}

export interface GithubIssueTarget {
  readonly repository: string;
  readonly kind: 'issue';
  readonly number: number;
}

export interface GithubPullRequestTarget {
  readonly repository: string;
  readonly kind: 'pull-request';
  readonly number: number;
}

export interface GithubLabelDefinitionTarget {
  readonly repository: string;
  readonly kind: 'label-definition';
  readonly name: string;
}

export interface GithubRemoteRefTarget {
  readonly repository: string;
  readonly kind: 'remote-ref';
  readonly ref: string;
}

export type GithubOperationTarget =
  | GithubRepositoryTarget
  | GithubIssueTarget
  | GithubPullRequestTarget
  | GithubLabelDefinitionTarget
  | GithubRemoteRefTarget;

export interface GithubPullRequestEditPayload {
  readonly title?: string;
  readonly body?: string;
}

/** Issue and pull-request comments share GitHub's issue-comment update API. */
export interface GithubCommentUpdatePayload {
  readonly commentId: string;
  readonly body: string;
}

/** @deprecated Use {@link GithubCommentUpdatePayload}; retained for API compatibility. */
export type GithubPullRequestCommentUpdatePayload = GithubCommentUpdatePayload;

export interface GithubDependencyPayload {
  readonly dependency: GithubIssueTarget;
  /**
   * GitHub's dependency endpoint accepts the blocking issue's database id.
   * Most existing callers only know an issue number, so it remains optional;
   * callers that performed the documented id lookup must retain that exact
   * value through the typed request instead of rebuilding raw argv.
   */
  readonly dependencyDatabaseId?: number;
}

/** A commit-status publication remains bound to its exact commit in the payload. */
export interface GithubCommitStatusPayload {
  readonly sha: string;
  readonly state: 'success' | 'failure';
  readonly context: string;
  readonly description: string;
}

export type GithubOperationPayload =
  | { readonly body: string }
  | { readonly label: string }
  | { readonly title: string; readonly body: string }
  | { readonly title: string; readonly body: string; readonly head: string; readonly base: string; readonly draft?: boolean }
  | { readonly name: string; readonly color?: string; readonly description?: string }
  | GithubPullRequestEditPayload
  | GithubCommentUpdatePayload
  | GithubDependencyPayload
  | GithubCommitStatusPayload;

/**
 * Checkout-scoped ("ambient") reads: `gh` resolves the repository or account
 * from the working directory, so no repository-bound target exists yet. These
 * are the discovery reads D1 admits without target ownership. The registry is
 * closed: an argv outside the named command shapes is refused, never treated
 * as read-only by default, and a repository-bound read must use a targeted
 * read operation instead.
 */
export const GITHUB_AMBIENT_READ_REGISTRY = {
  'ambient.identity.read': [['api', 'user'], ['auth', 'status']],
  'ambient.repository.read': [['repo', 'view']],
  'ambient.pull-request.read': [['pr', 'view'], ['pr', 'list']],
  'ambient.issue.read': [['issue', 'view']],
  /** The `gh --version` banner: a local CLI probe that never reaches GitHub, but is still a `gh` invocation. */
  'ambient.cli.read': [['--version']],
} as const satisfies Record<string, readonly (readonly string[])[]>;

export type GithubAmbientReadOperation = keyof typeof GITHUB_AMBIENT_READ_REGISTRY;

export interface GithubAmbientReadRequest {
  readonly operation: GithubAmbientReadOperation;
  readonly args: readonly string[];
}

const AMBIENT_WRITE_FLAG = /^(?:-X|--method|-f|-F|--field|--raw-field|--input)/;
const AMBIENT_REPOSITORY_FLAG = /^(?:-R|--repo)(?:=|$|.)/;

/** Decode an ambient read; every refusal happens before a transport is reached. */
export function decodeGithubAmbientRead(
  value: unknown,
): { readonly kind: 'accepted'; readonly request: GithubAmbientReadRequest } | { readonly kind: 'refused'; readonly reason: GithubOperationRefusalReason } {
  if (typeof value !== 'object' || value === null) return { kind: 'refused', reason: 'invalid-target' };
  const { operation, args } = value as { operation?: unknown; args?: unknown };
  if (typeof operation !== 'string' || !Object.hasOwn(GITHUB_AMBIENT_READ_REGISTRY, operation)) {
    return { kind: 'refused', reason: 'unsupported-operation' };
  }
  if (!Array.isArray(args) || !args.every((arg): arg is string => typeof arg === 'string')) {
    return { kind: 'refused', reason: 'invalid-target' };
  }
  const shapes = GITHUB_AMBIENT_READ_REGISTRY[operation as GithubAmbientReadOperation];
  const registered = shapes.some((shape) => shape.every((word, index) => args[index] === word)
    && (shape.length > 1 || args.length === shape.length));
  const bound = args.some((arg) => AMBIENT_REPOSITORY_FLAG.test(arg) || /(?:^|\/)repos\//.test(arg));
  const writes = args[0] === 'api' && args.slice(2).some((arg) => AMBIENT_WRITE_FLAG.test(arg));
  if (!registered || bound || writes) return { kind: 'refused', reason: 'invalid-target' };
  return { kind: 'accepted', request: { operation: operation as GithubAmbientReadOperation, args } };
}

interface GithubOperationDefinition {
  readonly access: GithubOperationAccess;
  readonly targetKinds: readonly GithubResourceKind[];
  readonly payload?: 'body' | 'label' | 'issue-create' | 'pull-request-create' | 'repository-create' | 'label-definition' | 'pull-request-edit' | 'comment-update' | 'dependency' | 'commit-status';
}

/** Every operation admitted by this boundary is named here. */
export const GITHUB_OPERATION_REGISTRY = {
  'issue.read': { access: 'read', targetKinds: ['issue'] },
  // Listing or observing a PR by branch starts with a repository-scoped
  // discovery query; once a number is known, callers retain the exact PR
  // target. Both forms remain within the same typed read operation.
  'pull-request.read': { access: 'read', targetKinds: ['pull-request', 'repository'] },
  'repository.read': { access: 'read', targetKinds: ['repository'] },
  'issue.comment.create': { access: 'feature-write', targetKinds: ['issue'], payload: 'body' },
  'issue.comment.update': { access: 'feature-write', targetKinds: ['issue'], payload: 'comment-update' },
  'issue.edit': { access: 'feature-write', targetKinds: ['issue'], payload: 'body' },
  'issue.close': { access: 'feature-write', targetKinds: ['issue'] },
  'issue.label.add': { access: 'feature-write', targetKinds: ['issue'], payload: 'label' },
  'issue.label.remove': { access: 'feature-write', targetKinds: ['issue'], payload: 'label' },
  'issue.dependency.add': { access: 'feature-write', targetKinds: ['issue'], payload: 'dependency' },
  'issue.dependency.remove': { access: 'feature-write', targetKinds: ['issue'], payload: 'dependency' },
  'pull-request.comment.create': { access: 'feature-write', targetKinds: ['pull-request'], payload: 'body' },
  'pull-request.comment.update': { access: 'feature-write', targetKinds: ['pull-request'], payload: 'comment-update' },
  'pull-request.edit': { access: 'feature-write', targetKinds: ['pull-request'], payload: 'pull-request-edit' },
  'pull-request.ready': { access: 'feature-write', targetKinds: ['pull-request'] },
  'pull-request.draft': { access: 'feature-write', targetKinds: ['pull-request'] },
  'pull-request.label.add': { access: 'feature-write', targetKinds: ['pull-request'], payload: 'label' },
  'pull-request.label.remove': { access: 'feature-write', targetKinds: ['pull-request'], payload: 'label' },
  'intake.issue.comment.create': { access: 'intake-write', targetKinds: ['issue'], payload: 'body' },
  'intake.issue.comment.update': { access: 'intake-write', targetKinds: ['issue'], payload: 'comment-update' },
  'intake.issue.close': { access: 'intake-write', targetKinds: ['issue'] },
  'intake.issue.label.add': { access: 'intake-write', targetKinds: ['issue'], payload: 'label' },
  'intake.issue.label.remove': { access: 'intake-write', targetKinds: ['issue'], payload: 'label' },
  'intake.issue.dependency.add': { access: 'intake-write', targetKinds: ['issue'], payload: 'dependency' },
  'issue.create': { access: 'create', targetKinds: ['repository'], payload: 'issue-create' },
  'pull-request.create': { access: 'create', targetKinds: ['repository'], payload: 'pull-request-create' },
  'commit.status.create': { access: 'feature-write', targetKinds: ['repository'], payload: 'commit-status' },
  'label-definition.create': { access: 'shared-write', targetKinds: ['label-definition'], payload: 'label-definition' },
  'label-definition.update': { access: 'shared-write', targetKinds: ['label-definition'], payload: 'label-definition' },
  'repository.create': { access: 'shared-write', targetKinds: ['repository'], payload: 'repository-create' },
  'remote-ref.push': { access: 'remote-ref-write', targetKinds: ['remote-ref'] },
  'remote-ref.delete': { access: 'remote-ref-write', targetKinds: ['remote-ref'] },
} as const satisfies Readonly<Record<string, GithubOperationDefinition>>;

export type GithubOperationName = keyof typeof GITHUB_OPERATION_REGISTRY;

export type GithubOperationRefusalReason =
  | 'other-owner'
  | 'unresolved-actor'
  | 'missing-provenance'
  | 'conflicting-provenance'
  | 'provenance-unreadable'
  | 'provenance-timeout'
  | 'invalid-target'
  | 'invalid-payload'
  | 'unsupported-operation'
  | 'explicit-authorization-required';

interface GithubOperationBase {
  readonly operation: GithubOperationName;
  readonly access: GithubOperationAccess;
  readonly target: GithubOperationTarget;
  readonly context: { readonly actor: string; readonly feature?: string };
  readonly payload?: GithubOperationPayload;
}

export type GithubReadOperationRequest = GithubOperationBase & { readonly access: 'read' };
export type GithubFeatureWriteOperationRequest = GithubOperationBase & { readonly access: 'feature-write' };
export type GithubIntakeWriteOperationRequest = GithubOperationBase & { readonly access: 'intake-write' };
export type GithubCreateOperationRequest = GithubOperationBase & { readonly access: 'create' };
export type GithubSharedWriteOperationRequest = GithubOperationBase & { readonly access: 'shared-write' };
export type GithubRemoteRefWriteOperationRequest = GithubOperationBase & { readonly access: 'remote-ref-write' };

export type GithubOperationRequest =
  | GithubReadOperationRequest
  | GithubFeatureWriteOperationRequest
  | GithubIntakeWriteOperationRequest
  | GithubCreateOperationRequest
  | GithubSharedWriteOperationRequest
  | GithubRemoteRefWriteOperationRequest;

export type GithubOperationDecodeResult =
  | { readonly kind: 'accepted'; readonly request: GithubOperationRequest }
  | { readonly kind: 'refused'; readonly reason: GithubOperationRefusalReason };

export type GithubOperationResult =
  | { readonly kind: 'executed'; readonly operation: GithubOperationName; readonly target: GithubOperationTarget }
  | { readonly kind: 'refused'; readonly operation: GithubOperationName; readonly reason: GithubOperationRefusalReason }
  | { readonly kind: 'failed'; readonly operation: GithubOperationName; readonly error: string }
  | {
    readonly kind: 'partial';
    readonly operation: GithubOperationName;
    readonly created: GithubOperationTarget;
    readonly metadataFailures: readonly { readonly operation: GithubOperationName; readonly error: string }[];
  };

export interface GithubOperationRunnerResponse {
  readonly created?: GithubOperationTarget;
  readonly metadataFailures?: readonly { readonly operation: GithubOperationName; readonly error: string }[];
}

/** A policy refusal is a normal outcome, never an exception or a fallback trigger. */
export interface GithubOperationRunnerRefusal {
  readonly kind: 'refused';
  readonly reason: GithubOperationRefusalReason;
}

/** Injectable guarded-operation seam. Task 6 adapts it to the canonical GhRunner. */
export interface GithubOperationRunner {
  run(request: GithubOperationRequest): Promise<GithubOperationRunnerResponse | GithubOperationRunnerRefusal>;
  /** Production guarded adapters carry the existing event-spine emitter. */
  readonly events?: GithubOperationEventEmitter;
}

/** The existing event spine boundary needed to report a denied mutation. */
export interface GithubOperationEventEmitter {
  emit(event: Extract<ConductorEvent, { type: 'github_operation_refused' }>): Promise<void>;
}

export interface GithubOperationExecutionOptions {
  readonly events?: GithubOperationEventEmitter;
  /** Read-only target resolution runs before any guarded operation reaches its runner. */
  readonly targetDiscovery?: GithubTargetDiscovery;
}

function isRunnerRefusal(
  response: GithubOperationRunnerResponse | GithubOperationRunnerRefusal,
): response is GithubOperationRunnerRefusal {
  return 'kind' in response && response.kind === 'refused';
}

export function githubOperationRefusalRemedy(
  reason: GithubOperationRefusalReason,
): GithubOperationRefusalRemedy {
  switch (reason) {
    case 'other-owner': return 'ask-resource-owner';
    case 'unresolved-actor': return 'configure-operator-identity';
    case 'missing-provenance': return 'record-feature-ownership';
    case 'conflicting-provenance': return 'repair-ownership-provenance';
    case 'provenance-unreadable':
    case 'provenance-timeout': return 'retry-provenance-read';
    case 'invalid-target': return 'correct-operation-target';
    case 'invalid-payload': return 'correct-operation-payload';
    case 'unsupported-operation': return 'use-supported-operation';
    case 'explicit-authorization-required': return 'request-explicit-authorization';
  }
}

export function formatGithubOperationTarget(target: GithubOperationTarget): string {
  switch (target.kind) {
    case 'issue': return `${target.repository}#${target.number}`;
    case 'pull-request': return `${target.repository}#${target.number}`;
    case 'label-definition': return `${target.repository} label:${target.name}`;
    case 'remote-ref': return `${target.repository} ${target.ref}`;
    case 'repository': return target.repository;
  }
}

/** One secret-safe rendering shared by terminal and standalone result consumers. */
export function formatGithubOperationRefusal(
  event: Extract<ConductorEvent, { type: 'github_operation_refused' }>,
): string {
  return `GitHub operation refused: ${event.operation} on ${formatGithubOperationTarget(event.target)} (${event.reason}); remedy: ${event.remedy}`;
}

/**
 * Deliver refusal telemetry through the sole GitHub-operation event variant.
 * Both GitHub and remote-Git guards call this so their reason/remedy vocabulary
 * and rendered payload cannot drift.
 */
export async function emitGithubOperationRefusal(
  refusal: Pick<Extract<ConductorEvent, { type: 'github_operation_refused' }>, 'operator' | 'target' | 'operation'>,
  reason: GithubOperationRefusalReason,
  events: GithubOperationEventEmitter | undefined,
): Promise<void> {
  if (events === undefined) return;
  try {
    await events.emit({
      type: 'github_operation_refused',
      operator: refusal.operator,
      target: refusal.target,
      operation: refusal.operation,
      reason,
      remedy: githubOperationRefusalRemedy(reason),
    });
  } catch {
    // A refusal is authoritative even when its best-effort telemetry cannot be delivered.
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function definitionFor(value: unknown): GithubOperationDefinition | undefined {
  if (typeof value !== 'string' || !Object.hasOwn(GITHUB_OPERATION_REGISTRY, value)) return undefined;
  return GITHUB_OPERATION_REGISTRY[value as GithubOperationName];
}

function targetFrom(resource: unknown, repository: unknown): GithubOperationTarget | undefined {
  if (typeof repository !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(repository)) return undefined;
  if (!record(resource) || typeof resource.kind !== 'string') return undefined;
  const kind = resource.kind;
  if (!['issue', 'pull-request', 'label-definition', 'remote-ref', 'repository'].includes(kind)) return undefined;
  if (kind === 'label-definition' && (typeof resource.name !== 'string' || resource.name === '')) return undefined;
  if (kind === 'remote-ref' && (typeof resource.ref !== 'string' || resource.ref === '')) return undefined;
  switch (kind) {
    case 'issue':
    case 'pull-request':
      if (typeof resource.number !== 'number' || !Number.isSafeInteger(resource.number) || resource.number < 1) {
        return undefined;
      }
      return { repository, kind, number: resource.number };
    case 'label-definition':
      return { repository, kind, name: resource.name as string };
    case 'remote-ref':
      return { repository, kind, ref: resource.ref as string };
    case 'repository':
      return { repository, kind };
    default:
      return undefined;
  }
}

function refused(reason: GithubOperationRefusalReason): GithubOperationDecodeResult {
  return { kind: 'refused', reason };
}

function targetInputFrom(
  value: unknown,
  target: GithubOperationTarget,
): GithubTargetInput {
  const raw = record(value) ? value : {};
  const rawUrl = typeof raw.url === 'string' ? raw.url : undefined;
  const rawRef = typeof raw.ref === 'string' ? raw.ref : undefined;
  return {
    repository: target.repository,
    resource: target,
    ...(rawUrl === undefined ? {} : { url: rawUrl }),
    ...(rawRef === undefined
      ? target.kind === 'remote-ref' ? { ref: target.ref } : {}
      : { ref: rawRef }),
  };
}

/**
 * Typed callers can supply a resource handle directly, but it remains
 * untrusted input to the canonical resolver.  Production compositions that
 * have an authoritative remote lookup replace this read-only seam.
 */
const directTargetDiscovery: GithubTargetDiscovery = {
  async resolve(input) {
    if (input.repository === undefined || input.resource === undefined) return { ambiguous: true };
    return { repository: input.repository, resource: input.resource };
  },
};

function withResolvedTarget(
  request: GithubOperationRequest,
  target: GithubOperationTarget,
): GithubOperationRequest {
  return { ...request, target } as GithubOperationRequest;
}

function payloadFrom(value: unknown, required: GithubOperationDefinition['payload']): GithubOperationPayload | undefined {
  if (required === undefined) return undefined;
  if (!record(value)) return undefined;
  if (required === 'body' && typeof value.body === 'string') return { body: value.body };
  if (required === 'label' && typeof value.label === 'string' && value.label !== '') return { label: value.label };
  if (required === 'issue-create' && typeof value.title === 'string' && typeof value.body === 'string') {
    return { title: value.title, body: value.body };
  }
  if (required === 'repository-create' && (value.body === 'private' || value.body === 'public')) {
    return { body: value.body };
  }
  if (required === 'pull-request-create'
    && typeof value.title === 'string'
    && typeof value.body === 'string'
    && typeof value.head === 'string'
    && typeof value.base === 'string') {
    return {
      title: value.title,
      body: value.body,
      head: value.head,
      base: value.base,
      ...(typeof value.draft === 'boolean' ? { draft: value.draft } : {}),
    };
  }
  if (required === 'label-definition' && typeof value.name === 'string') {
    return {
      name: value.name,
      ...(typeof value.color === 'string' ? { color: value.color } : {}),
      ...(typeof value.description === 'string' ? { description: value.description } : {}),
    };
  }
  if (required === 'pull-request-edit'
    && (typeof value.title === 'string' || typeof value.body === 'string')) {
    return {
      ...(typeof value.title === 'string' ? { title: value.title } : {}),
      ...(typeof value.body === 'string' ? { body: value.body } : {}),
    };
  }
  if (required === 'comment-update'
    && typeof value.commentId === 'string'
    && /^\d+$/.test(value.commentId)
    && typeof value.body === 'string') {
    return { commentId: value.commentId, body: value.body };
  }
  if (required === 'dependency' && record(value.dependency)) {
    const dependency = targetFrom(value.dependency.resource, value.dependency.repository);
    if (dependency?.kind === 'issue') {
      const dependencyDatabaseId = value.dependencyDatabaseId;
      if (dependencyDatabaseId !== undefined
        && (typeof dependencyDatabaseId !== 'number' || !Number.isSafeInteger(dependencyDatabaseId) || dependencyDatabaseId <= 0)) {
        return undefined;
      }
      return {
        dependency,
        ...(dependencyDatabaseId === undefined ? {} : { dependencyDatabaseId }),
      };
    }
  }
  if (required === 'commit-status'
    && typeof value.sha === 'string' && value.sha !== ''
    && (value.state === 'success' || value.state === 'failure')
    && typeof value.context === 'string' && value.context !== ''
    && typeof value.description === 'string' && value.description !== '') {
    return {
      sha: value.sha,
      state: value.state,
      context: value.context,
      description: value.description,
    };
  }
  return undefined;
}

/** Decode a registered shape, deriving access solely from the registry. */
export function decodeGithubOperationRequest(value: unknown): GithubOperationDecodeResult {
  if (!record(value)) return refused('invalid-target');
  const definition = definitionFor(value.operation);
  if (!definition) return refused('unsupported-operation');
  const target = targetFrom(value.resource, value.repository);
  if (!target || !definition.targetKinds.includes(target.kind)) return refused('invalid-target');
  if (!record(value.context) || typeof value.context.actor !== 'string' || value.context.actor.trim() === '') {
    return refused('unresolved-actor');
  }
  const payload = payloadFrom(value.payload, definition.payload);
  if (definition.payload !== undefined && !payload) {
    return refused('invalid-payload');
  }
  if (target.kind === 'label-definition'
    && payload
    && 'name' in payload
    && payload.name !== target.name) {
    return refused('invalid-target');
  }
  if (definition.payload === undefined && Object.hasOwn(value, 'payload')) {
    return refused('invalid-payload');
  }
  return {
    kind: 'accepted',
    request: {
      operation: value.operation as GithubOperationName,
      access: definition.access,
      target,
      context: {
        actor: value.context.actor,
        ...(typeof value.context.feature === 'string' ? { feature: value.context.feature } : {}),
      },
      ...(payload ? { payload } : {}),
    } as GithubOperationRequest,
  };
}

/** Refused decoding never reaches the injectable terminal seam. */
export async function executeGithubOperation(
  value: unknown,
  runner: GithubOperationRunner,
  options: GithubOperationExecutionOptions = {},
): Promise<GithubOperationResult | Extract<GithubOperationDecodeResult, { kind: 'refused' }>> {
  const decoded = decodeGithubOperationRequest(value);
  if (decoded.kind === 'refused') return decoded;
  const resolution = await resolveGithubTarget(
    targetInputFrom(value, decoded.request.target),
    options.targetDiscovery ?? directTargetDiscovery,
  );
  if (resolution.kind === 'refused') return resolution;
  const request = withResolvedTarget(decoded.request, resolution.target);
  try {
    const response = await runner.run(request);
    if (isRunnerRefusal(response)) {
      const result = {
        kind: 'refused',
        operation: request.operation,
        reason: response.reason,
      } as const;
      if (request.access !== 'read') {
        await emitGithubOperationRefusal({
          operator: request.context.actor,
          target: request.target,
          operation: request.operation,
        }, response.reason, options.events ?? runner.events);
      }
      return result;
    }
    if (response.created && response.metadataFailures && response.metadataFailures.length > 0) {
      return {
        kind: 'partial',
        operation: request.operation,
        created: response.created,
        metadataFailures: response.metadataFailures,
      };
    }
    if (response.metadataFailures?.length) {
      return {
        kind: 'failed',
        operation: request.operation,
        error: 'GitHub metadata follow-up failed without a created resource.',
      };
    }
    return {
      kind: 'executed',
      operation: request.operation,
      target: response.created ?? request.target,
    };
  } catch (error) {
    return {
      kind: 'failed',
      operation: request.operation,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
