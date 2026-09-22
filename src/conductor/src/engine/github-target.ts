import type { GithubOperationRefusalReason, GithubOperationTarget, GithubResourceKind } from './github-operations.js';

/** The caller-supplied handles from which a GitHub resource is resolved. */
export interface GithubTargetInput {
  readonly repository?: string;
  readonly url?: string;
  readonly ref?: string;
  /**
   * A caller that already holds the resource-shaped handle still sends it
   * through discovery.  This lets the boundary compare that handle with URL
   * and ref aliases instead of trusting a separately constructed target.
   */
  readonly resource?: GithubTargetResource;
}

export type GithubTargetResource = {
  readonly kind: GithubResourceKind;
  readonly number?: number;
  readonly name?: string;
  readonly ref?: string;
};

export type GithubTargetDiscoveryResult =
  | { readonly repository: string; readonly resource: GithubTargetResource }
  | { readonly ambiguous: true };

/** Read-only discovery seam; it is deliberately separate from mutation policy. */
export interface GithubTargetDiscovery {
  resolve(input: GithubTargetInput): Promise<GithubTargetDiscoveryResult>;
}

export type GithubTargetResolution =
  | { readonly kind: 'resolved'; readonly target: GithubOperationTarget }
  | { readonly kind: 'refused'; readonly reason: Extract<GithubOperationRefusalReason, 'invalid-target'> };

type ParsedGithubUrl = {
  readonly repository: string;
  readonly number?: number;
  readonly route?: 'issues' | 'pull';
};

const REPOSITORY_SEGMENT = /^[A-Za-z0-9_.-]+$/;

function validRemoteRef(value: string): boolean {
  return value.startsWith('refs/')
    && value.length > 'refs/'.length
    && !value.includes('//')
    && !value.endsWith('/')
    && !value.includes('..')
    && !value.endsWith('.')
    && !value.includes('@{')
    && !/[\s~^:\\?*\[]/.test(value);
}

function canonicalRepository(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = value.split('/');
  if (parts.length !== 2 || !REPOSITORY_SEGMENT.test(parts[0]) || !REPOSITORY_SEGMENT.test(parts[1])) {
    return undefined;
  }
  return `${parts[0].toLowerCase()}/${parts[1].toLowerCase()}`;
}

function positiveNumber(value: string): number | undefined {
  if (!/^[1-9]\d*$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : undefined;
}

/** Parse only browser GitHub URLs that identify one supported GitHub resource route. */
export function parseGithubUrl(value: unknown): ParsedGithubUrl | undefined {
  if (typeof value !== 'string' || value.trim() !== value || value === '') return undefined;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.username || parsed.password) {
    return undefined;
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2 || !REPOSITORY_SEGMENT.test(segments[0]) || !REPOSITORY_SEGMENT.test(segments[1])) {
    return undefined;
  }
  const repository = canonicalRepository(`${segments[0]}/${segments[1]}`);
  if (!repository) return undefined;
  if (segments.length === 2) return { repository };
  if (segments.length !== 4 || !['issues', 'pull'].includes(segments[2])) return undefined;
  const number = positiveNumber(segments[3]);
  if (!number) return undefined;
  return { repository, number, route: segments[2] as 'issues' | 'pull' };
}

function resourceTarget(resource: unknown, repository: string): GithubOperationTarget | undefined {
  if (!resource || typeof resource !== 'object' || Array.isArray(resource)) return undefined;
  const candidate = resource as Record<string, unknown>;
  switch (candidate.kind) {
    case 'issue':
    case 'pull-request':
      if (typeof candidate.number !== 'number' || !Number.isSafeInteger(candidate.number) || candidate.number < 1) {
        return undefined;
      }
      return { repository, kind: candidate.kind, number: candidate.number };
    case 'label-definition':
      return typeof candidate.name === 'string' && candidate.name.trim() !== ''
        ? { repository, kind: 'label-definition', name: candidate.name }
        : undefined;
    case 'remote-ref':
      return typeof candidate.ref === 'string' && validRemoteRef(candidate.ref)
        ? { repository, kind: 'remote-ref', ref: candidate.ref }
        : undefined;
    case 'repository':
      return { repository, kind: 'repository' };
    default:
      return undefined;
  }
}

function invalidTarget(): GithubTargetResolution {
  return { kind: 'refused', reason: 'invalid-target' };
}

function inputIsValid(input: unknown): input is GithubTargetInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const candidate = input as Record<string, unknown>;
  return ['repository', 'url', 'ref'].every((key) => candidate[key] === undefined || typeof candidate[key] === 'string')
    && (candidate.resource === undefined || (typeof candidate.resource === 'object' && candidate.resource !== null));
}

/**
 * Resolve a possibly aliased caller handle to one canonical, repository-bound
 * target. Discovery is untrusted input: its failure, ambiguity, or malformed
 * response is a refusal before a target can reach mutation policy.
 */
export async function resolveGithubTarget(
  input: GithubTargetInput,
  discovery: GithubTargetDiscovery,
): Promise<GithubTargetResolution> {
  if (!inputIsValid(input) || !discovery || typeof discovery.resolve !== 'function') return invalidTarget();
  if (input.repository === undefined && input.url === undefined && input.ref === undefined) return invalidTarget();
  if (input.repository !== undefined && !canonicalRepository(input.repository)) return invalidTarget();
  if (input.url !== undefined && !parseGithubUrl(input.url)) return invalidTarget();
  if (input.ref !== undefined && !validRemoteRef(input.ref)) return invalidTarget();

  const explicitRepository = input.repository === undefined ? undefined : canonicalRepository(input.repository);
  const url = input.url === undefined ? undefined : parseGithubUrl(input.url);
  if (explicitRepository && url && explicitRepository !== url.repository) return invalidTarget();
  const identityRepository = explicitRepository ?? url?.repository;
  const explicitResource = input.resource === undefined || identityRepository === undefined
    ? undefined
    : resourceTarget(input.resource, identityRepository);
  if (input.resource !== undefined && !explicitResource) return invalidTarget();

  let discovered: GithubTargetDiscoveryResult;
  try {
    discovered = await discovery.resolve(input);
  } catch {
    return invalidTarget();
  }
  if (!discovered || typeof discovered !== 'object' || Array.isArray(discovered) || 'ambiguous' in discovered) {
    return invalidTarget();
  }

  const repository = canonicalRepository(discovered.repository);
  if (!repository || (explicitRepository && explicitRepository !== repository) || (url && url.repository !== repository)) {
    return invalidTarget();
  }
  const target = resourceTarget(discovered.resource, repository);
  if (!target) return invalidTarget();

  if (explicitResource && !githubTargetsMatch(target, explicitResource)) return invalidTarget();

  // A repository handle alone does not identify a PR, issue, label, or ref.
  // Discovery may only return the repository resource for that input shape.
  if (input.resource === undefined && input.ref === undefined && url?.number === undefined && target.kind !== 'repository') {
    return invalidTarget();
  }

  // An issues URL may be the issue-shaped alias of a pull request; discovery
  // distinguishes the two. A pull URL is unambiguously a pull request.
  if (url?.number !== undefined) {
    if ((target.kind !== 'issue' && target.kind !== 'pull-request')
      || target.number !== url.number
      || (url.route === 'pull' && target.kind !== 'pull-request')) {
      return invalidTarget();
    }
  }
  if (input.ref !== undefined && (target.kind !== 'remote-ref' || target.ref !== input.ref)) return invalidTarget();

  return { kind: 'resolved', target };
}

/** Compare the full canonical resource identity; a ref alone is never enough. */
export function githubTargetsMatch(left: GithubOperationTarget, right: GithubOperationTarget): boolean {
  const leftRepository = canonicalRepository(left.repository);
  const rightRepository = canonicalRepository(right.repository);
  if (!leftRepository || !rightRepository || leftRepository !== rightRepository) return false;

  switch (left.kind) {
    case 'issue':
    case 'pull-request':
      return right.kind === left.kind && right.number === left.number;
    case 'label-definition':
      return right.kind === 'label-definition' && right.name === left.name;
    case 'remote-ref':
      return right.kind === 'remote-ref' && right.ref === left.ref;
    case 'repository':
      return right.kind === 'repository';
  }
}
