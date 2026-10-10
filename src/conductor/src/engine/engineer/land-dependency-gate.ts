// Land-time dependency proposal computation. This module is deliberately
// stricter than the shared overlap preflight: an unavailable tracker read must
// refuse land, while the existing filing and DECIDE callers remain advisory.

import { parsePlanTaskPaths } from '../plan-task-parse.js';
import type { GitRunner } from '../rebase.js';
import { runTrackerRead, type GhRunner } from '../tracker-client.js';
import { compareEdges, declaredEdges } from './dependency-reconciler.js';
import { parseSourceRef } from './issue-ref.js';
import { buildSuggestions } from './intake/overlap-suggestions.js';
import { collectInFlightOverlaps, collectOpenIssueOverlaps } from './intake/overlap-sources.js';

export interface LandDependencyProposal {
  target: string;
  source: 'declared' | 'overlap';
}

export interface LandDependencyAdvisory {
  branch?: string;
  target?: string;
  reason: 'markerless-branch' | 'self' | 'already-linked';
}

export type LandDependencyProposalResult =
  | {
    kind: 'computed';
    proposals: LandDependencyProposal[];
    satisfied: string[];
    advisory: LandDependencyAdvisory[];
  }
  | { kind: 'unavailable'; cause: string };

export interface ComputeLandDependencyProposalsInput {
  sourceRef: string;
  planText: string;
  gh: GhRunner;
  git: GitRunner;
  cwd: string;
  /** The resolved target checkout base. Land callers normally supply it. */
  baseRef?: string;
}

export interface DecideLandDependenciesInput {
  sourceRef?: string;
  proposalResult: LandDependencyProposalResult;
  accepted: string[];
  declined: string[];
  skipReason?: string;
}

export type LandDependencyDecision =
  | {
    kind: 'proceed';
    accepted: string[];
    declined: string[];
    skipped: { reason: string } | null;
  }
  | {
    kind: 'refused-undecided';
    undecided: string[];
    message: string;
    skipUnused?: string;
  }
  | { kind: 'refused-unavailable'; cause: string; message: string }
  | { kind: 'invalid'; message: string };

interface RawBlockedByEntry {
  number: number;
  repository_url?: string;
}

function repoFromRepositoryUrl(url: string): string | null {
  const match = url.match(/\/repos\/([^/]+\/[^/]+)\/?$/);
  return match?.[1] ?? null;
}

function actualBlockedBy(repository: string, raw: string): Set<string> {
  let entries: unknown;
  try {
    entries = JSON.parse(raw || '[]');
  } catch {
    throw new Error('source blocked_by response was not valid JSON');
  }
  if (!Array.isArray(entries)) throw new Error('source blocked_by response was not an array');
  const targets = new Set<string>();
  for (const entry of entries as RawBlockedByEntry[]) {
    if (!entry || !Number.isSafeInteger(entry.number) || entry.number <= 0) continue;
    targets.add(`${entry.repository_url ? repoFromRepositoryUrl(entry.repository_url) ?? repository : repository}#${entry.number}`);
  }
  return targets;
}

function unavailable(stage: string, error: unknown): LandDependencyProposalResult {
  const detail = error instanceof Error ? error.message : String(error);
  const cause = /rate[ -]?limit/i.test(detail)
    ? `tracker rate limit while reading ${stage}: ${detail}`
    : `tracker read failed for ${stage}: ${detail}`;
  return { kind: 'unavailable', cause };
}

function planPaths(planText: string): string[] {
  return [...parsePlanTaskPaths(planText).values()].flatMap((paths) => [...paths]);
}

/**
 * Decide whether land may continue after the proposal calculation. This stays
 * pure so the CLI can render or reject the returned outcome before commit.
 */
export function decideLandDependencies({
  sourceRef,
  proposalResult,
  accepted,
  declined,
  skipReason,
}: DecideLandDependenciesInput): LandDependencyDecision {
  const hasDecision = accepted.length > 0 || declined.length > 0;
  if (hasDecision && !sourceRef) {
    return { kind: 'invalid', message: 'dependency decisions require an intake source-ref' };
  }
  if (skipReason !== undefined && skipReason.trim() === '') {
    return { kind: 'invalid', message: 'a dependency-check skip requires a reason' };
  }

  switch (proposalResult.kind) {
    case 'unavailable':
      if (skipReason !== undefined) {
        return { kind: 'proceed', accepted: [], declined: [], skipped: { reason: skipReason } };
      }
      return {
        kind: 'refused-unavailable',
        cause: proposalResult.cause,
        message: `${proposalResult.cause}; retry or acknowledge with --skip-dependency-check "<reason>"`,
      };
    case 'computed': {
      const proposed = new Set(proposalResult.proposals.map((proposal) => proposal.target));
      const contradictory = accepted.find((target) => declined.includes(target));
      if (contradictory) {
        return { kind: 'invalid', message: `dependency ${contradictory} was both accepted and declined` };
      }
      const invalidDecline = declined.find((target) => !proposed.has(target));
      if (invalidDecline) {
        return { kind: 'invalid', message: `cannot decline dependency ${invalidDecline}: it was never proposed` };
      }
      const decided = new Set([...accepted, ...declined]);
      const undecided = proposalResult.proposals
        .map((proposal) => proposal.target)
        .filter((target) => !decided.has(target));
      if (undecided.length > 0) {
        return {
          kind: 'refused-undecided',
          undecided,
          message: `undecided dependencies: ${undecided.join(', ')}. Decide each with --depends-on <owner/repo#N> or --decline-dependency <owner/repo#N>.`,
          ...(skipReason === undefined ? {} : { skipUnused: `--skip-dependency-check "${skipReason}" was unused because proposals were computed` }),
        };
      }
      return { kind: 'proceed', accepted, declined, skipped: null };
    }
  }
}

/**
 * Compute every dependency the land gate must ask the operator to decide.
 * Tracker reads fail closed here under ADR D6; local in-flight git evidence
 * remains advisory through the established overlap helper contract.
 */
export async function computeLandDependencyProposals({
  sourceRef,
  planText,
  gh,
  git,
  cwd,
  baseRef = 'main',
}: ComputeLandDependencyProposalsInput): Promise<LandDependencyProposalResult> {
  const source = parseSourceRef(sourceRef);
  if (!source) return { kind: 'unavailable', cause: `tracker read failed for source issue: invalid source ref '${sourceRef}'` };

  let body: string;
  try {
    const stdout = await runTrackerRead(
      gh, cwd, 'issue.read', source.repo, { kind: 'issue', number: Number(source.number) },
      ['issue', 'view', source.number, '--json', 'body', '-R', source.repo],
    );
    const parsed: unknown = JSON.parse(stdout || '{}');
    if (!parsed || typeof parsed !== 'object' || typeof (parsed as { body?: unknown }).body !== 'string') {
      throw new Error('source body response was missing body');
    }
    body = (parsed as { body: string }).body;
  } catch (error) {
    return unavailable('source body', error);
  }

  let blockedBy: Set<string>;
  try {
    const stdout = await runTrackerRead(
      gh, cwd, 'issue.read', source.repo, { kind: 'issue', number: Number(source.number) },
      ['api', `repos/${source.repo}/issues/${source.number}/dependencies/blocked_by`],
    );
    blockedBy = actualBlockedBy(source.repo, stdout);
  } catch (error) {
    return unavailable('source blocked_by', error);
  }

  const declared = declaredEdges({ ref: sourceRef, body }).edges;
  const comparison = compareEdges(declared, blockedBy);
  const citedPaths = planPaths(planText);

  let issueOverlaps;
  try {
    issueOverlaps = await collectOpenIssueOverlaps({
      gh, cwd, repository: source.repo, citedPaths,
    });
  } catch (error) {
    return unavailable('open-issue overlap listing', error);
  }

  const inFlight = await collectInFlightOverlaps({
    git, baseRef, citedPaths, repository: source.repo, gh, cwd,
  });
  const suggestions = buildSuggestions({
    issueOverlaps: issueOverlaps.overlaps.map((overlap) => ({
      ...overlap,
      issue: overlap.issue.startsWith('#') ? `${source.repo}${overlap.issue}` : overlap.issue,
    })),
    branchOverlaps: inFlight.overlaps,
    alreadyNamed: [...blockedBy],
  });

  const proposals: LandDependencyProposal[] = [];
  const add = (target: string, proposalSource: LandDependencyProposal['source']) => {
    if (target === sourceRef || blockedBy.has(target) || proposals.some((proposal) => proposal.target === target)) return;
    proposals.push({ target, source: proposalSource });
  };
  for (const edge of comparison.unlinked) add(edge.target, 'declared');
  for (const suggestion of suggestions.shown) add(suggestion.issue, 'overlap');

  const advisory: LandDependencyAdvisory[] = [];
  for (const branch of suggestions.advisory) {
    advisory.push({ branch: branch.branch, reason: 'markerless-branch' });
  }
  for (const suggestion of suggestions.preAccepted) {
    advisory.push({ target: suggestion.issue, reason: 'already-linked' });
  }
  for (const overlap of issueOverlaps.overlaps) {
    const target = overlap.issue.startsWith('#') ? `${source.repo}${overlap.issue}` : overlap.issue;
    if (target === sourceRef) advisory.push({ target, reason: 'self' });
  }

  return {
    kind: 'computed',
    proposals,
    satisfied: comparison.satisfied.map((edge) => edge.target),
    advisory,
  };
}
