import { parseChildId, type ChildId } from '../child-context.js';
import { leafBranchFor } from '../feature-branch-identity.js';
import { makeGitRunner, type GitRunner } from '../rebase.js';

/**
 * Engine-owned terminal result requested from a routed BUILD provider.  It is
 * intentionally closed: a provider cannot smuggle an unrecognised outcome
 * into the movement path.
 */
export const PREREQUISITE_CLAIM_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['outcome'],
      properties: { outcome: { const: 'completed' } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['outcome', 'child'],
      properties: {
        outcome: { const: 'blocked-by-prerequisite' },
        child: { type: 'integer', minimum: 1 },
        paths: { type: 'array', items: { type: 'string', minLength: 1 } },
        symbols: { type: 'array', items: { type: 'string', minLength: 1 } },
      },
    },
  ],
} as const;

export interface PrerequisiteClaim {
  readonly outcome: 'blocked-by-prerequisite';
  readonly child: ChildId;
  readonly paths?: readonly string[];
  readonly symbols?: readonly string[];
}

export type ParsedBuilderClaim =
  | { readonly kind: 'none' }
  | { readonly kind: 'claim'; readonly claim: PrerequisiteClaim }
  | { readonly kind: 'malformed' };

function stringList(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) return undefined;
  return value;
}

/** Parse the provider's terminal payload without accepting partially valid claims. */
export function parseBuilderClaim(result: unknown): ParsedBuilderClaim {
  if (result === undefined || result === null) return { kind: 'none' };
  if (typeof result !== 'object' || Array.isArray(result)) return { kind: 'malformed' };
  const value = result as Record<string, unknown>;
  if (value.outcome === 'completed' && Object.keys(value).length === 1) return { kind: 'none' };
  if (value.outcome !== 'blocked-by-prerequisite') return { kind: 'malformed' };
  if (!Object.keys(value).every((key) => key === 'outcome' || key === 'child' || key === 'paths' || key === 'symbols')) return { kind: 'malformed' };
  const child = (typeof value.child === 'string' || typeof value.child === 'number')
    ? parseChildId(value.child)
    : undefined;
  if (!child) return { kind: 'malformed' };
  const paths = value.paths === undefined ? undefined : stringList(value.paths);
  const symbols = value.symbols === undefined ? undefined : stringList(value.symbols);
  if ((value.paths !== undefined && paths === undefined) || (value.symbols !== undefined && symbols === undefined)) return { kind: 'malformed' };
  return { kind: 'claim', claim: { outcome: 'blocked-by-prerequisite', child, ...(paths === undefined ? {} : { paths }), ...(symbols === undefined ? {} : { symbols }) } };
}

export type VerifyPrerequisiteClaimResult =
  | { readonly kind: 'verified'; readonly destination: ChildId; readonly ref: string }
  | { readonly kind: 'unverified'; readonly detail: string }
  | { readonly kind: 'refused-not-above'; readonly detail: string };

export interface VerifyPrerequisiteClaimInput {
  readonly claim: PrerequisiteClaim;
  readonly host: ChildId;
  readonly slug: string;
  readonly git?: GitRunner;
  readonly worktree?: string;
  /** Inputs from the admitted work order that must exist at the destination. */
  readonly prerequisitePaths?: readonly string[];
}

async function existingRef(git: GitRunner, ref: string): Promise<boolean> {
  try { return (await git(['rev-parse', '-q', '--verify', ref])).exitCode === 0; } catch { return false; }
}

async function hasPaths(git: GitRunner, ref: string, paths: readonly string[]): Promise<boolean> {
  for (const path of paths) {
    try {
      const result = await git(['ls-tree', '-r', '--name-only', ref, '--', path]);
      if (result.exitCode !== 0 || !result.stdout.split('\n').map((line) => line.trim()).includes(path)) return false;
    } catch { return false; }
  }
  return true;
}

async function hasSymbols(git: GitRunner, ref: string, symbols: readonly string[]): Promise<boolean> {
  for (const symbol of symbols) {
    // Git performs the tree lookup, so this cannot accidentally inspect the
    // checked-out host after a reroute has changed it.
    try {
      const result = await git(['grep', '-E', `(^|[[:space:]])export([[:space:]]|.*[[:space:]])(${symbol})([[:space:](=:]|$)`, ref, '--']);
      if (result.exitCode !== 0) return false;
    } catch { return false; }
  }
  return true;
}

/**
 * Validate a requested upward destination against the immutable closed tree.
 * A missing closed ref denotes the leaf branch; no ref is moved by verification.
 */
export async function verifyPrerequisiteClaim(input: VerifyPrerequisiteClaimInput): Promise<VerifyPrerequisiteClaimResult> {
  if (input.claim.child <= input.host) {
    return { kind: 'refused-not-above', detail: `claimed child ${input.claim.child} is not above host ${input.host}` };
  }
  const git = input.git ?? makeGitRunner(input.worktree ?? process.cwd());
  const closed = `refs/conductor/${input.slug}/closed/c${input.claim.child}`;
  const ref = await existingRef(git, closed) ? closed : `refs/heads/${leafBranchFor(input.slug)}`;
  if (!await existingRef(git, ref)) return { kind: 'unverified', detail: `claimed destination ${input.claim.child} is unavailable` };
  const paths = [...(input.claim.paths ?? []), ...(input.prerequisitePaths ?? [])];
  if (!await hasPaths(git, ref, paths)) return { kind: 'unverified', detail: `claimed destination ${input.claim.child} lacks prerequisite paths` };
  if (!await hasSymbols(git, ref, input.claim.symbols ?? [])) return { kind: 'unverified', detail: `claimed destination ${input.claim.child} lacks prerequisite symbols` };
  return { kind: 'verified', destination: input.claim.child, ref };
}
