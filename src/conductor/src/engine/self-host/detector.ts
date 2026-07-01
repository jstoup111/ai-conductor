// self-host/detector.ts — "is the repo under build the harness itself?"
//
// The activation seam for the whole self-host guardrail bundle
// (adr-2026-06-30-self-host-detection-seam / TR-1..TR-3). It is an INTERFACE,
// not a bare path compare, so a future platform identity (EKS/OIDC) can replace
// path comparison without changing what the guardrails do — exactly the
// owner-gate `resolveDaemonOwner` seam precedent.
//
// Two invariants:
//   1. Identity is by RESOLVED PATH (realpath), never by repo name — a repo that
//      merely happens to be named `james-stoup-agents` is not the harness.
//   2. Activation is POSITIVE-ONLY: anything uncertain (unresolved harness root,
//      unresolvable build path) → false, i.e. the unchanged normal build path.
//      A self-build is only ever entered on a confident positive identification.

import { realpath } from 'node:fs/promises';
import { resolveHarnessRoot } from '../install-freshness.js';
import { resolveSelfHostConfig } from '../resolved-config.js';
import type { HarnessConfig } from '../../types/config.js';

/**
 * Swappable seam: decides whether the build at `buildRepoRoot` is the harness
 * self-build. Guardrail activation depends on THIS interface (TR-3), never on
 * `resolveHarnessRoot` directly, so the identity mechanism can be replaced
 * without touching guardrail behavior.
 */
export interface SelfHostDetector {
  isSelfHost(buildRepoRoot: string): Promise<boolean>;
}

/** Resolves the harness root (dir containing `bin/install`), or null. Injectable. */
export type HarnessRootResolver = () => Promise<string | null>;

/**
 * Default path-comparison detector: self-host iff the build repo's realpath
 * equals the harness root's realpath. realpath canonicalizes symlinks, `..`
 * segments, and trailing slashes, so cosmetic path differences never cause a
 * false negative, and identity can never hinge on a repo's name.
 */
export class PathSelfHostDetector implements SelfHostDetector {
  constructor(
    private readonly resolveRoot: HarnessRootResolver = resolveHarnessRoot,
    private readonly debug: (message: string) => void = () => {},
  ) {}

  async isSelfHost(buildRepoRoot: string): Promise<boolean> {
    const root = await this.resolveRoot();
    if (root === null) {
      // Positive-only: an unresolved harness root can never be a self-build.
      this.debug('self-host detection: harness root unresolved');
      return false;
    }
    const buildReal = await canonicalize(buildRepoRoot);
    const rootReal = await canonicalize(root);
    if (buildReal === null || rootReal === null) return false;
    return buildReal === rootReal;
  }
}

/** realpath a path, or null if it does not resolve (never throws). */
async function canonicalize(p: string): Promise<string | null> {
  try {
    return await realpath(p);
  } catch {
    return null;
  }
}

/** The concrete default detector, used when none is injected (no null-seam). */
export function defaultSelfHostDetector(): SelfHostDetector {
  return new PathSelfHostDetector();
}

/**
 * Combine the config activation override with the detector (TR-2). Config wins
 * over the seam: `force_on` → true for any repo, `force_off` → false even for
 * the harness; `auto`/absent → delegate to the detector's path comparison.
 * This is the single entry point the daemon uses to classify a build.
 */
export async function classifySelfHost(
  detector: SelfHostDetector,
  config: HarnessConfig | undefined,
  buildRepoRoot: string,
): Promise<boolean> {
  const { activation } = resolveSelfHostConfig(config);
  if (activation === 'force_on') return true;
  if (activation === 'force_off') return false;
  return detector.isSelfHost(buildRepoRoot);
}
