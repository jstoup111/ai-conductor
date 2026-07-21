// overlap-scan.ts — DECIDE-time unmerged-overlap scan (#523, Scope A).
//
// SCAFFOLD ONLY (pre-implementation): types + signatures so the acceptance and
// unit specs load and fail on real assertions (RED), not on collection errors.
// Every function throws — `/pipeline` (Tasks 1-6) replaces each throw with the
// real implementation, one task at a time, per the plan's TDD cycle.

import type { GitRunner } from './rebase.js';
import type { BlockerResolver, IssueRef } from './blocker-resolver.js';

export interface SeamOverlap {
  branch: string;
  files: string[];
}

export interface OverlapReport {
  seamOverlaps: SeamOverlap[];
  blockers: IssueRef[];
  indeterminate: { detail: string }[];
  skipNotes: string[];
}

export interface RunOverlapScanArgs {
  candidateFiles: string[];
  git: GitRunner;
  resolver: BlockerResolver;
  sourceRef?: string;
  localBase: string;
}

export function enumerateUnmergedBranches(
  _git: GitRunner,
  _base: string,
): Promise<string[]> {
  throw new Error('not implemented: enumerateUnmergedBranches (Task 1)');
}

export function intersectFiles(_candidate: string[], _changed: string[]): string[] {
  throw new Error('not implemented: intersectFiles (Task 2)');
}

export function blockerSweep(
  _sourceRef: string | undefined,
  _resolver: BlockerResolver,
): Promise<{ blockers: IssueRef[]; indeterminate: { detail: string }[] }> {
  throw new Error('not implemented: blockerSweep (Task 3)');
}

export function runOverlapScan(_args: RunOverlapScanArgs): Promise<OverlapReport> {
  throw new Error('not implemented: runOverlapScan (Task 4/5)');
}

export function renderReport(_report: OverlapReport): string {
  throw new Error('not implemented: renderReport (Task 6)');
}
