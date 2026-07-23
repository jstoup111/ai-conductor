// engineer/issue-ref.ts — shared issue-reference helpers for intake linkage.
//
// One place owns: parsing `owner/repo#N` source refs, formatting a GitHub
// linking line (`Closes …` / `Refs …`), and injecting that line into an existing
// PR body via `gh` — idempotently and NON-FATALLY.
//
// Used by:
//   - handoff.ts (openSpecPr)  → `Refs owner/repo#N` on the SPEC PR (links, no close)
//   - daemon-cli.ts            → `Closes owner/repo#N` on the IMPLEMENTATION PR
//                                 (GitHub auto-closes the issue on merge)
//   - github-issues.ts re-exports `parseSourceRef` so the adapter and these
//     helpers agree on a single parse contract.
//
// All gh access is injected; nothing here touches the network in tests.

import { parseWorkRef } from './source-ref.js';

/** Shell runner for the `gh` CLI. Mirrors the intake adapter's GhRunner shape. */
export type GhRunner = (args: string[], opts: { cwd: string }) => Promise<{ stdout: string }>;

/** GitHub linking keyword. `Closes` auto-closes on merge; `Refs` only links. */
export type IssueRefKeyword = 'Closes' | 'Refs';

/**
 * Parse `owner/repo#123` into its repo + issue-number parts, or null if malformed.
 *
 * Compat shim over {@link parseWorkRef}: delegates to the generalized work-ref
 * grammar and narrows to the GitHub shape, returning null for any other kind
 * (e.g. a Jira key) or unparseable input. A null result means "no usable issue
 * reference" — every caller treats that as a no-op rather than an error.
 */
export function parseSourceRef(sourceRef: string | undefined | null): { repo: string; number: string } | null {
  const r = parseWorkRef(sourceRef);
  return r?.kind === 'github' ? { repo: r.repo, number: r.number } : null;
}

/**
 * Format a GitHub linking line, e.g. `Closes acme/app#49`. Returns null when the
 * sourceRef is unparseable (caller skips injection).
 */
export function formatIssueRef(keyword: IssueRefKeyword, sourceRef: string | undefined | null): string | null {
  const parsed = parseSourceRef(sourceRef);
  if (!parsed) return null;
  return `${keyword} ${parsed.repo}#${parsed.number}`;
}

/** Escape a string for safe inclusion in a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when `body` already references the issue with the relevant keyword family.
 * For `Closes` the family is the GitHub closing keywords (close/fix/resolve and
 * their inflections); for `Refs` it is the reference keywords. The issue token
 * matches either `#N` or `owner/repo#N`, with a digit boundary so `#4` never
 * matches inside `#49`. Used to keep injection idempotent (FR-6).
 */
export function bodyReferencesIssue(
  body: string,
  keyword: IssueRefKeyword,
  parsed: { repo: string; number: string },
): boolean {
  const token = `(?:${escapeRegExp(parsed.repo)})?#${parsed.number}(?!\\d)`;
  const family =
    keyword === 'Closes'
      ? '(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)'
      : '(?:refs?|references?)';
  return new RegExp(`\\b${family}\\b\\s+${token}`, 'i').test(body);
}

/** Options for {@link injectIssueRef}. */
export interface InjectIssueRefOpts {
  gh: GhRunner;
  /** The PR URL (or number) to edit. */
  prUrl: string;
  keyword: IssueRefKeyword;
  /** The originating issue reference, `owner/repo#N`. */
  sourceRef: string | undefined | null;
  /** Working directory for the gh calls. */
  cwd: string;
  log?: (msg: string) => void;
}

/**
 * Append a GitHub linking line to an existing PR body via `gh pr edit`.
 *
 * Contract:
 *   - Unparseable / absent sourceRef → no-op, returns false (FR-5).
 *   - Body already references the issue with this keyword family → no-op,
 *     returns false (FR-6 idempotency).
 *   - Otherwise edits the body and returns true.
 *   - ANY gh failure (outage, no remote, bad URL) is logged and swallowed —
 *     returns false, never throws (FR-7 non-fatal).
 */
export async function injectIssueRef(opts: InjectIssueRefOpts): Promise<boolean> {
  const { gh, prUrl, keyword, sourceRef, cwd } = opts;
  const log = opts.log ?? (() => {});

  const parsed = parseSourceRef(sourceRef);
  if (!parsed) {
    log(`injectIssueRef: no usable sourceRef ("${sourceRef ?? ''}") — skipping ${keyword}`);
    return false;
  }
  const line = `${keyword} ${parsed.repo}#${parsed.number}`;

  try {
    const { stdout } = await gh(['pr', 'view', prUrl, '--json', 'body'], { cwd });
    let body = '';
    try {
      body = String((JSON.parse(stdout || '{}') as { body?: unknown }).body ?? '');
    } catch {
      body = '';
    }

    if (bodyReferencesIssue(body, keyword, parsed)) {
      return false; // already linked — nothing to do.
    }

    const newBody = body.trim() === '' ? line : `${body.replace(/\s+$/, '')}\n\n${line}`;
    await gh(['pr', 'edit', prUrl, '--body', newBody], { cwd });
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`injectIssueRef: non-fatal write-back failure for ${prUrl} (${line}) — ${msg}`);
    return false;
  }
}

/** Outcome of {@link closeIssueOnImplementationMerge}, for logging/telemetry. */
export type CloseIssueOutcome = 'no-source-ref' | 'no-pr-url' | 'attempted';

/** Dependencies for {@link closeIssueOnImplementationMerge}. */
export interface CloseIssueOnMergeDeps {
  gh: GhRunner;
  /** Originating issue ref carried on the backlog item; undefined for non-intake specs. */
  sourceRef: string | undefined;
  /** The implementation PR URL recorded after the daemon build (from conduct-state). */
  prUrl: string | undefined;
  cwd: string;
  /** Slug for log context. */
  slug?: string;
  log?: (msg: string) => void;
}

/**
 * After the daemon builds an intake-originated feature, add `Closes owner/repo#N`
 * to the implementation PR so GitHub auto-closes the issue when the PR merges.
 *
 * Gated and non-fatal:
 *   - no `sourceRef` (hand-authored spec)      → 'no-source-ref' (no gh call)
 *   - `sourceRef` but no PR (e.g. build halted) → 'no-pr-url' (logged, no gh call)
 *   - otherwise → 'attempted' (idempotent body edit via injectIssueRef; any gh
 *     failure is swallowed inside injectIssueRef, never thrown).
 */
export async function closeIssueOnImplementationMerge(
  deps: CloseIssueOnMergeDeps,
): Promise<CloseIssueOutcome> {
  const log = deps.log ?? (() => {});
  if (!deps.sourceRef) return 'no-source-ref';
  if (!deps.prUrl) {
    log(
      `issue-link: ${deps.slug ?? '(feature)'} carries sourceRef ${deps.sourceRef} but no ` +
        `implementation PR was recorded (build halted?) — skipping Closes injection`,
    );
    return 'no-pr-url';
  }
  await injectIssueRef({
    gh: deps.gh,
    prUrl: deps.prUrl,
    keyword: 'Closes',
    sourceRef: deps.sourceRef,
    cwd: deps.cwd,
    log: deps.log,
  });
  return 'attempted';
}
