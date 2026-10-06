import { parseChildId, type ChildId } from './child-context.js';

export const LEAF_PREFIX = 'feat/daemon-';
export const SPEC_PREFIX = 'spec/';
export const INTERACTIVE_PREFIX = 'feature/';

const CHILD_BRANCH_PREFIX = 'feat/c';
const CHILD_BRANCH_REST = /^(\d+)(?:\/(.*))?$/;

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