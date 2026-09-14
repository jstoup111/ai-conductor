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

export interface GithubPullRequestCommentUpdatePayload {
  readonly commentId: string;
  readonly body: string;
}

export interface GithubDependencyPayload {
  readonly dependency: GithubIssueTarget;
}

export type GithubOperationPayload =
  | { readonly body: string }
  | { readonly label: string }
  | { readonly title: string; readonly body: string }
  | { readonly title: string; readonly body: string; readonly head: string; readonly base: string }
  | { readonly name: string; readonly color?: string; readonly description?: string }
  | GithubPullRequestEditPayload
  | GithubPullRequestCommentUpdatePayload
  | GithubDependencyPayload;

interface GithubOperationDefinition {
  readonly access: GithubOperationAccess;
  readonly targetKinds: readonly GithubResourceKind[];
  readonly payload?: 'body' | 'label' | 'issue-create' | 'pull-request-create' | 'label-definition' | 'pull-request-edit' | 'pull-request-comment-update' | 'dependency';
}

/** Every operation admitted by this boundary is named here. */
export const GITHUB_OPERATION_REGISTRY = {
  'issue.read': { access: 'read', targetKinds: ['issue'] },
  'pull-request.read': { access: 'read', targetKinds: ['pull-request'] },
  'repository.read': { access: 'read', targetKinds: ['repository'] },
  'issue.comment.create': { access: 'feature-write', targetKinds: ['issue'], payload: 'body' },
  'issue.edit': { access: 'feature-write', targetKinds: ['issue'], payload: 'body' },
  'issue.close': { access: 'feature-write', targetKinds: ['issue'] },
  'issue.label.add': { access: 'feature-write', targetKinds: ['issue'], payload: 'label' },
  'issue.label.remove': { access: 'feature-write', targetKinds: ['issue'], payload: 'label' },
  'issue.dependency.add': { access: 'feature-write', targetKinds: ['issue'], payload: 'dependency' },
  'issue.dependency.remove': { access: 'feature-write', targetKinds: ['issue'], payload: 'dependency' },
  'pull-request.comment.create': { access: 'feature-write', targetKinds: ['pull-request'], payload: 'body' },
  'pull-request.comment.update': { access: 'feature-write', targetKinds: ['pull-request'], payload: 'pull-request-comment-update' },
  'pull-request.edit': { access: 'feature-write', targetKinds: ['pull-request'], payload: 'pull-request-edit' },
  'pull-request.ready': { access: 'feature-write', targetKinds: ['pull-request'] },
  'pull-request.draft': { access: 'feature-write', targetKinds: ['pull-request'] },
  'pull-request.label.add': { access: 'feature-write', targetKinds: ['pull-request'], payload: 'label' },
  'pull-request.label.remove': { access: 'feature-write', targetKinds: ['pull-request'], payload: 'label' },
  'intake.issue.comment.create': { access: 'intake-write', targetKinds: ['issue'], payload: 'body' },
  'intake.issue.close': { access: 'intake-write', targetKinds: ['issue'] },
  'issue.create': { access: 'create', targetKinds: ['repository'], payload: 'issue-create' },
  'pull-request.create': { access: 'create', targetKinds: ['repository'], payload: 'pull-request-create' },
  'label-definition.create': { access: 'shared-write', targetKinds: ['label-definition'], payload: 'label-definition' },
  'label-definition.update': { access: 'shared-write', targetKinds: ['label-definition'], payload: 'label-definition' },
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
}

function isRunnerRefusal(
  response: GithubOperationRunnerResponse | GithubOperationRunnerRefusal,
): response is GithubOperationRunnerRefusal {
  return 'kind' in response && response.kind === 'refused';
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

function payloadFrom(value: unknown, required: GithubOperationDefinition['payload']): GithubOperationPayload | undefined {
  if (required === undefined) return undefined;
  if (!record(value)) return undefined;
  if (required === 'body' && typeof value.body === 'string') return { body: value.body };
  if (required === 'label' && typeof value.label === 'string' && value.label !== '') return { label: value.label };
  if (required === 'issue-create' && typeof value.title === 'string' && typeof value.body === 'string') {
    return { title: value.title, body: value.body };
  }
  if (required === 'pull-request-create'
    && typeof value.title === 'string'
    && typeof value.body === 'string'
    && typeof value.head === 'string'
    && typeof value.base === 'string') {
    return { title: value.title, body: value.body, head: value.head, base: value.base };
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
  if (required === 'pull-request-comment-update'
    && typeof value.commentId === 'string'
    && /^\d+$/.test(value.commentId)
    && typeof value.body === 'string') {
    return { commentId: value.commentId, body: value.body };
  }
  if (required === 'dependency' && record(value.dependency)) {
    const dependency = targetFrom(value.dependency.resource, value.dependency.repository);
    if (dependency?.kind === 'issue') return { dependency };
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
): Promise<GithubOperationResult | Extract<GithubOperationDecodeResult, { kind: 'refused' }>> {
  const decoded = decodeGithubOperationRequest(value);
  if (decoded.kind === 'refused') return decoded;
  try {
    const response = await runner.run(decoded.request);
    if (isRunnerRefusal(response)) {
      return {
        kind: 'refused',
        operation: decoded.request.operation,
        reason: response.reason,
      };
    }
    if (response.created && response.metadataFailures && response.metadataFailures.length > 0) {
      return {
        kind: 'partial',
        operation: decoded.request.operation,
        created: response.created,
        metadataFailures: response.metadataFailures,
      };
    }
    if (response.metadataFailures?.length) {
      return {
        kind: 'failed',
        operation: decoded.request.operation,
        error: 'GitHub metadata follow-up failed without a created resource.',
      };
    }
    return {
      kind: 'executed',
      operation: decoded.request.operation,
      target: response.created ?? decoded.request.target,
    };
  } catch (error) {
    return {
      kind: 'failed',
      operation: decoded.request.operation,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
