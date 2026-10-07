import { parseChildId, type ChildId } from './child-context.js';

export const LEAF_PREFIX = 'feat/daemon-';
export const SPEC_PREFIX = 'spec/';
export const INTERACTIVE_PREFIX = 'feature/';

export const CHILD_REF_GLOBS = [
  'refs/heads/feat/c[1-9]/*',
  'refs/remotes/*/feat/c[1-9]/*',
];

export const LEAF_REF_GLOBS = [
  'refs/heads/feat/daemon-*',
  'refs/remotes/*/feat/daemon-*',
];

export const SPEC_REF_GLOBS = [
  'refs/heads/spec/*',
  'refs/remotes/*/spec/*',
];

const CHILD_BRANCH_PREFIX = 'feat/c';
const CHILD_BRANCH_REST = /^(\d+)(?:\/(.*))?$/;

const LOCAL_REF_PREFIX = 'refs/heads/';
const REMOTE_REF_PREFIX = 'refs/remotes/';
const OWNED_NON_PREFIX_SEGMENTS = new Set(['feat', 'spec', 'feature']);

export type FeatureBranchIdentity =
  | { kind: 'leaf'; slug: string }
  | { kind: 'child'; slug: string; child: ChildId }
  | { kind: 'spec'; slug: string }
  | { kind: 'interactive'; slug: string }
  | { kind: 'unrecognized'; raw: string; reason: string };

export type ChildBranchResult =
  | { ok: true; branch: string }
  | { ok: false; reason: string };

export function leafBranchFor(slug: string): string {
  return `${LEAF_PREFIX}${slug}`;
}

export function childBranchFor(slug: string, child: number): ChildBranchResult {
  const id = parseChildId(child);
  if (id === undefined) {
    return { ok: false, reason: `invalid child id "${child}"` };
  }
  if (slug === '' || slug.includes('/')) {
    return { ok: false, reason: `invalid slug "${slug}"` };
  }
  return { ok: true, branch: `feat/c${id}/${slug}` };
}

export function parseFeatureBranch(raw: string): FeatureBranchIdentity {
  if (raw.startsWith(LEAF_PREFIX)) {
    const slug = raw.slice(LEAF_PREFIX.length);
    if (slug === '') {
      return { kind: 'unrecognized', raw, reason: 'empty slug' };
    }
    return { kind: 'leaf', slug };
  }

  if (raw.startsWith(CHILD_BRANCH_PREFIX)) {
    const rest = raw.slice(CHILD_BRANCH_PREFIX.length);
    const match = CHILD_BRANCH_REST.exec(rest);
    if (match === null) {
      return { kind: 'unrecognized', raw, reason: 'invalid child id' };
    }
    const digits = match[1];
    const remainder = match[2];
    const child = parseChildId(digits);
    if (child === undefined) {
      return { kind: 'unrecognized', raw, reason: `invalid child id "${digits}"` };
    }
    if (remainder === undefined || remainder === '') {
      return { kind: 'unrecognized', raw, reason: 'missing slug' };
    }
    if (remainder.includes('/')) {
      return { kind: 'unrecognized', raw, reason: 'multi-segment slug' };
    }
    const rebuilt = childBranchFor(remainder, child);
    if (!rebuilt.ok || rebuilt.branch !== raw) {
      return { kind: 'unrecognized', raw, reason: 'invalid child id' };
    }
    return { kind: 'child', slug: remainder, child };
  }

  if (raw.startsWith(SPEC_PREFIX)) {
    const slug = raw.slice(SPEC_PREFIX.length);
    if (slug === '') {
      return { kind: 'unrecognized', raw, reason: 'empty slug' };
    }
    return { kind: 'spec', slug };
  }

  if (raw.startsWith(INTERACTIVE_PREFIX)) {
    const slug = raw.slice(INTERACTIVE_PREFIX.length);
    if (slug === '') {
      return { kind: 'unrecognized', raw, reason: 'empty slug' };
    }
    return { kind: 'interactive', slug };
  }

  return { kind: 'unrecognized', raw, reason: 'unrecognized' };
}

export function parseFeatureRef(ref: string): FeatureBranchIdentity {
  if (ref.startsWith(LOCAL_REF_PREFIX)) {
    return parseFeatureBranch(ref.slice(LOCAL_REF_PREFIX.length));
  }
  if (ref.startsWith(REMOTE_REF_PREFIX)) {
    const rest = ref.slice(REMOTE_REF_PREFIX.length);
    const slashIndex = rest.indexOf('/');
    return parseFeatureBranch(slashIndex === -1 ? rest : rest.slice(slashIndex + 1));
  }
  if (parseFeatureBranch(ref).kind === 'unrecognized') {
    const slashIndex = ref.indexOf('/');
    const firstSegment = slashIndex === -1 ? ref : ref.slice(0, slashIndex);
    if (!OWNED_NON_PREFIX_SEGMENTS.has(firstSegment)) {
      return parseFeatureBranch(slashIndex === -1 ? ref : ref.slice(slashIndex + 1));
    }
  }
  return parseFeatureBranch(ref);
}

export function isDaemonOwnedBranchName(name: string): boolean {
  return name.startsWith(LEAF_PREFIX) || parseFeatureBranch(name).kind === 'child';
}

export function featureSlugOf(identity: FeatureBranchIdentity): string | undefined {
  if (identity.kind === 'unrecognized') {
    return undefined;
  }
  return identity.slug;
}