import type { OverlapSuggestions, OverlapSuggestion, BranchOverlap, IssueOverlap } from './overlap-suggestions.js';
import type { ConductorEvent } from '../../../types/events.js';
import { parseSourceRef } from '../issue-ref.js';
import { buildSuggestions } from './overlap-suggestions.js';
import { extractCitedPaths } from './cited-paths.js';
import { collectInFlightOverlaps, collectOpenIssueOverlaps, selectInFlightBranches } from './overlap-sources.js';
import { resolveTargetCheckout, type ResolveTargetCheckoutOptions } from './target-checkout.js';
import { makeGitRunner, resolveBase, type GitRunner } from '../../rebase.js';
import type { GhRunner } from '../../tracker-client.js';
import { changedPathsSinceMergeBase } from '../../rebase.js';

export interface OverlapSkipNote {
  part: string;
  reason: string;
}

export type OverlapDecision =
  | {
    kind: 'proceed';
    accepted: string[];
    declined: string[];
    advisory: BranchOverlap[];
    skipNotes: OverlapSkipNote[];
    omittedCount: number;
  }
  | {
    kind: 'refused';
    undecided: OverlapSuggestion[];
    advisory: BranchOverlap[];
    skipNotes: OverlapSkipNote[];
    omittedCount: number;
  }
  | {
    kind: 'invalid-decline';
    invalid: string[];
    advisory: BranchOverlap[];
    skipNotes: OverlapSkipNote[];
    omittedCount: number;
  };

export interface OverlapPreflightInput {
  title: string;
  body: string;
  dependsOn: readonly string[];
  interactive: boolean;
  prompt?: (question: string) => Promise<string>;
  declineOverlap?: readonly string[];
}

export interface OverlapCollection {
  issueOverlaps: IssueOverlap[];
  branchOverlaps: BranchOverlap[];
  skipNotes: OverlapSkipNote[];
  citedPaths: string[];
}

export interface OverlapSources {
  collect(input: Pick<OverlapPreflightInput, 'title' | 'body'>): Promise<OverlapCollection>;
}

/** Combine independently degradable read-only collectors into a suggestion set. */
export async function collectOverlaps({
  title,
  body,
  openIssues,
  inFlight,
  gh,
  cwd,
  repository,
  registryReader,
  makeGit = makeGitRunner,
}: {
  title: string;
  body: string;
  openIssues?: (citedPaths: readonly string[]) => Promise<IssueOverlap[]>;
  inFlight?: (citedPaths: readonly string[]) => Promise<{ overlaps: BranchOverlap[]; skipNotes?: string[] }>;
  gh?: GhRunner;
  cwd?: string;
  repository?: string;
  registryReader?: ResolveTargetCheckoutOptions['registryReader'];
  makeGit?: (cwd: string) => GitRunner;
}): Promise<OverlapCollection> {
  const skipNotes: OverlapSkipNote[] = [];
  let git: GitRunner | undefined;
  let baseRef: string | undefined;
  let knownPaths: Set<string> | undefined;
  let selectedBranches: Awaited<ReturnType<typeof selectInFlightBranches>> | undefined;

  // Resolve independently of the tracker read: an invalid registry must never
  // prevent the open-issue comparison or the eventual filing.
  if (gh && cwd && repository) {
    try {
      const checkout = await resolveTargetCheckout({ cwd, repository, registryReader });
      if (checkout.kind === 'none') {
        skipNotes.push({ part: 'in-flight', reason: checkout.reason });
      } else {
        git = makeGit(checkout.path);
        baseRef = (await resolveBase(git, 'main')).ref;
        const verified = await git(['rev-parse', '--verify', baseRef]);
        if (verified.exitCode !== 0) throw new Error(`base ref '${baseRef}' could not be resolved`);
        const tree = await git(['ls-tree', '-r', '--name-only', baseRef]);
        knownPaths = new Set(tree.stdout.split('\n').filter(Boolean));
        selectedBranches = await selectInFlightBranches({ git, baseRef });
        for (const reason of selectedBranches.skipNotes) skipNotes.push({ part: 'in-flight', reason });
        for (const branch of selectedBranches.branches) {
          try {
            const changed = await changedPathsSinceMergeBase(git, baseRef, branch);
            for (const path of changed ?? []) knownPaths.add(path);
          } catch (error) {
            skipNotes.push({ part: 'in-flight', reason: `skipped known-path diff for branch ${branch}: ${error instanceof Error ? error.message : String(error)}` });
          }
        }
      }
    } catch (error) {
      git = undefined;
      baseRef = undefined;
      skipNotes.push({ part: 'in-flight', reason: error instanceof Error ? error.message : String(error) });
    }
  }
  const citedPaths = extractCitedPaths(`${title}\n${body}`, knownPaths);
  let issueOverlaps: IssueOverlap[] = [];
  if (gh && cwd && repository) {
    try {
      const result = await collectOpenIssueOverlaps({ gh, cwd, repository, citedPaths, knownPaths });
      issueOverlaps = result.overlaps;
      for (const reason of result.skipNotes) skipNotes.push({ part: 'open-issues', reason });
    } catch (error) { skipNotes.push({ part: 'open-issues', reason: error instanceof Error ? error.message : String(error) }); }
  } else if (openIssues) {
    try { issueOverlaps = await openIssues(citedPaths); }
    catch (error) { skipNotes.push({ part: 'open-issues', reason: error instanceof Error ? error.message : String(error) }); }
  }
  let branchOverlaps: BranchOverlap[] = [];
  if (git && baseRef) {
    try {
      const result = await collectInFlightOverlaps({ git, baseRef, citedPaths, repository, gh, cwd, selectedBranches });
      branchOverlaps = result.overlaps;
      for (const reason of result.skipNotes) skipNotes.push({ part: 'in-flight', reason });
    } catch (error) { skipNotes.push({ part: 'in-flight', reason: error instanceof Error ? error.message : String(error) }); }
  } else if (inFlight) {
    try {
      const result = await inFlight(citedPaths);
      branchOverlaps = result.overlaps;
      for (const reason of result.skipNotes ?? []) skipNotes.push({ part: 'in-flight', reason });
    } catch (error) { skipNotes.push({ part: 'in-flight', reason: error instanceof Error ? error.message : String(error) }); }
  }
  return { issueOverlaps, branchOverlaps, skipNotes, citedPaths };
}

/**
 * Production overlap sources.  The in-flight scan is deliberately rooted only
 * in the checkout proved to belong to the filing repository.
 */
export function buildOverlapSources({
  cwd,
  repository,
  gh,
  registryReader,
  makeGit = makeGitRunner,
}: {
  cwd: string;
  repository: string;
  gh: GhRunner;
  registryReader?: ResolveTargetCheckoutOptions['registryReader'];
  makeGit?: (cwd: string) => GitRunner;
}): OverlapPreflightDeps['suggestions'] {
  return async (input) => {
    const collected = await collectOverlaps({
      title: input.title, body: input.body, gh, cwd, repository, registryReader, makeGit,
    });
    const canonicalIssue = (issue: string) => issue.startsWith('#') ? `${repository}${issue}` : issue;
    const suggestions = buildSuggestions({
      issueOverlaps: collected.issueOverlaps.map((overlap) => ({ ...overlap, issue: canonicalIssue(overlap.issue) })),
      branchOverlaps: collected.branchOverlaps.map((overlap) => ({
        ...overlap,
        issue: overlap.issue === null ? null : canonicalIssue(overlap.issue),
      })),
      alreadyNamed: input.dependsOn,
    });
    return { ...suggestions, ...(collected.skipNotes.length > 0 ? { skipNotes: collected.skipNotes } : {}) };
  };
}

/** The injected, read-only source of overlap suggestions for one filing. */
export interface OverlapPreflightDeps {
  suggestions: (input: OverlapPreflightInput) => Promise<OverlapSuggestions>;
  /** The CLI's existing canonical event spine; no overlap-specific log is opened. */
  events?: { emit(event: Extract<ConductorEvent, { type: 'intake_overlap_checked' }>): Promise<void> };
  /** The filing target recorded with the overlap decision when telemetry is enabled. */
  repository?: string;
}

/** Build the single, secret-safe overlap occurrence carried by the event spine. */
export function intakeOverlapCheckedEvent(
  repository: string,
  suggestions: OverlapSuggestions,
  decision: OverlapDecision,
): Extract<ConductorEvent, { type: 'intake_overlap_checked' }> {
  return {
    type: 'intake_overlap_checked',
    repository,
    outcome: decision.kind === 'proceed' ? 'proceeded' : decision.kind,
    suggested: [...suggestions.preAccepted, ...suggestions.shown].map(({ issue }) => issue),
    accepted: decision.kind === 'proceed' ? [...decision.accepted] : [],
    declined: decision.kind === 'proceed' ? [...decision.declined] : [],
    undecided: decision.kind === 'refused' ? decision.undecided.map(({ issue }) => issue) : [],
    advisoryCount: suggestions.advisory.length,
    skipped: decision.skipNotes.map(({ part, reason }) => ({ part, reason })),
  };
}

/**
 * The pre-creation decision boundary. Later tasks add acceptance, decline and
 * refusal choices; its first contract is that an empty suggestion set proceeds
 * without prompting or changing the creation transaction.
 */
export async function runOverlapPreflight(
  input: OverlapPreflightInput,
  deps: OverlapPreflightDeps,
): Promise<OverlapDecision> {
  const suggestions = await deps.suggestions(input);
  const skipNotes = suggestions.skipNotes ?? [];
  const sameIssue = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
  const declined: string[] = [];
  const invalid = (input.declineOverlap ?? []).filter((value) => {
    const parsed = parseSourceRef(value);
    const canonical = parsed ? `${parsed.repo}#${parsed.number}` : undefined;
    const suggestion = canonical && [...suggestions.shown, ...(suggestions.omitted ?? []), ...suggestions.preAccepted]
      .find(({ issue }) => sameIssue(issue, canonical));
    if (suggestion) {
      declined.push(suggestion.issue);
      return false;
    }
    return true;
  });
  let undecided = suggestions.shown.filter(({ issue }) => !declined.includes(issue));
  let accepted: string[] = [];
  if (invalid.length > 0) {
    const decision: OverlapDecision = { kind: 'invalid-decline', invalid, advisory: [...suggestions.advisory], skipNotes, omittedCount: suggestions.omittedCount ?? 0 };
    if (deps.events && deps.repository) await deps.events.emit(intakeOverlapCheckedEvent(deps.repository, suggestions, decision));
    return decision;
  }
  if (input.interactive && input.prompt) {
    for (const suggestion of [...undecided]) {
      while (true) {
        try {
          const answer = (await input.prompt(`Overlap with ${suggestion.issue} (${suggestion.sharedPaths.join(', ')}): accept or decline?`)).trim().toLowerCase();
          if (answer === 'a' || answer === 'accept') { accepted.push(suggestion.issue); break; }
          if (answer === 'd' || answer === 'decline') { declined.push(suggestion.issue); break; }
        } catch { break; }
      }
    }
    undecided = suggestions.shown.filter(({ issue }) => !accepted.includes(issue) && !declined.includes(issue));
  }
  const decision: OverlapDecision = undecided.length > 0
    ? { kind: 'refused', undecided, advisory: [...suggestions.advisory], skipNotes, omittedCount: suggestions.omittedCount ?? 0 }
    : { kind: 'proceed', accepted, declined, advisory: [...suggestions.advisory], skipNotes, omittedCount: suggestions.omittedCount ?? 0 };
  if (deps.events && deps.repository) {
    await deps.events.emit(intakeOverlapCheckedEvent(deps.repository, suggestions, decision));
  }
  return decision;
}
