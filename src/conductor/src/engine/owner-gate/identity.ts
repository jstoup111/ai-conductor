// owner-gate/identity.ts — resolve "who is this daemon building for?"
//
// The daemon must answer WHO it builds for before it can gate merged specs by
// owner (ADR: adr-2026-06-30-owner-gate-identity-resolution). Resolution is an
// ordered chain behind a seam: a CONFIGURED owner wins; else the gh-authed
// login; else UNRESOLVED (the gate is inactive / fail-open, handled by callers).
//
// Naming boundary (ADR-1): the operator concept is `specOwner` / `daemonOwner` /
// `ownerIdentity` — NEVER a bare `owner` identifier, which is reserved for
// `daemon-lock.ts`'s lock-holding process. This module is the operator feature;
// the lock is untouched.
//
// Forward-compat seam: `resolveDaemonOwner` composes injectable steps, so a
// future `PlatformIdentity` (EKS/OIDC) resolver can replace the chain without
// changing the gate's build/skip behavior.

/**
 * Shell runner for the `gh` CLI. Mirrors the GhRunner shape used across the
 * engine (engineer/loop.ts, pr-labels.ts) — defined here so owner-gate has no
 * dependency on those modules. Injected in tests; nothing here touches the
 * network directly.
 */
export type GhRunner = (
  args: string[],
  opts: { cwd: string },
) => Promise<{ stdout: string }>;

/** Minimal config surface this module reads. Full type lives in types/config.ts. */
export interface OwnerConfig {
  spec_owner?: string | null;
}

/**
 * The outcome of resolving a daemon's owner. `resolved: false` is the explicit
 * unresolved state — callers treat it as "gate inactive / fail-open", never as
 * an empty-string owner.
 */
export type OwnerResolution = { resolved: true; id: string } | { resolved: false };

/**
 * Canonicalize an owner id so comparison tolerates cosmetic differences
 * (FR-12): trim surrounding whitespace and lowercase. A blank / whitespace-only
 * / absent value normalizes to `null` (un-owned). No substring or fuzzy
 * matching — distinct ids like `alice` and `alice-bot` stay distinct.
 */
export function normalizeOwnerId(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed === '' ? null : trimmed;
}

/**
 * Resolve the owner from explicit configuration (FR-1). A configured
 * `spec_owner` always wins over the gh fallback, so behavior never changes
 * silently when gh re-auths. A blank / whitespace-only value is treated as
 * unconfigured (`resolved: false`).
 */
export function configuredOwner(config: OwnerConfig): OwnerResolution {
  const id = normalizeOwnerId(config.spec_owner);
  return id === null ? { resolved: false } : { resolved: true, id };
}

/**
 * Resolve the owner from the authenticated GitHub user (FR-2): `gh api user`
 * `.login`, normalized. Every failure mode degrades to `resolved: false`
 * (FR-2 negative) — a non-zero gh exit surfaces as a thrown runner error, an
 * absent gh binary throws, and a blank / empty login yields no id. Never
 * crashes; never returns an empty-string id.
 */
export async function ghLoginOwner(gh: GhRunner, cwd: string): Promise<OwnerResolution> {
  let login: string | null;
  try {
    const { stdout } = await gh(['api', 'user', '--jq', '.login'], { cwd });
    login = normalizeOwnerId(stdout);
  } catch {
    return { resolved: false };
  }
  // `gh ... --jq .login` prints the LITERAL text "null" when the API returns a
  // JSON null login (and "undefined" for an absent field). Guard both so a
  // no-login payload degrades to unresolved rather than an owner id of "null".
  if (login === null || login === 'null' || login === 'undefined') return { resolved: false };
  return { resolved: true, id: login };
}

/**
 * Ordered owner resolution chain (FR-1/2/3): configured owner wins; else the
 * gh-authed login; else `resolved: false` (unresolved → gate inactive). The
 * current config is read every call — no caching — so a reconfigured identity
 * takes effect on the next discovery pass (FR-14).
 */
export async function resolveDaemonOwner(
  config: OwnerConfig,
  gh: GhRunner,
  cwd: string,
): Promise<OwnerResolution> {
  const configured = configuredOwner(config);
  if (configured.resolved) return configured;
  return ghLoginOwner(gh, cwd);
}
