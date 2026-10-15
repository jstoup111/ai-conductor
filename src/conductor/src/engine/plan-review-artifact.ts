import { createHash } from 'node:crypto';

import { parsePlanTaskBodies, parsePlanTaskTitles } from './plan-task-parse.js';
import { selectPlanReviewAdrDecisionSections } from './plan-review-adr-scope.js';
import type { PlanReviewFinding } from './plan-review-contract.js';

/**
 * Worktree-relative directory of the plan-review gate record. The record is land-time
 * evidence only: land verifies it in the authoring worktree and never commits it, and
 * the daemon treats a merged spec without one as `landed-before-plan-review`.
 */
export const PLAN_REVIEW_ARTIFACT_DIR = '.docs/plan-review';

export type PlanReviewIndependence = 'cross-provider' | 'same-provider' | 'unknown-host';

export interface PlanReviewDisposition {
  readonly findingId: string;
  readonly kind: 'accepted' | 'resolved';
  readonly reason: string;
}

/** The source-component identities a review round covers. */
export interface ReviewedDigest {
  readonly digest: string;
  readonly planTaskDigests: Readonly<Record<string, string>>;
  readonly storyDigests: Readonly<Record<string, string>>;
  readonly adrDecisionDigests: Readonly<Record<string, string>>;
  readonly artifactDigests: Readonly<Record<string, string>>;
}

export interface PlanReviewArtifact {
  readonly round: number;
  readonly authoringHost: string;
  readonly reviewerProvider: string;
  readonly independence: PlanReviewIndependence;
  readonly findings: readonly PlanReviewFinding[];
  readonly dispositions: readonly PlanReviewDisposition[];
  readonly reviewedDigest: ReviewedDigest;
}

export interface ComputeReviewedDigestInput {
  readonly planText: string;
  readonly storiesText: string;
  readonly adrTexts: Readonly<Record<string, string>>;
  readonly artifactTexts: Readonly<Record<string, string>>;
  /** Repository-relative changed paths used to include ADRs newly in this change set. */
  readonly changedPaths: readonly string[];
}

export interface ReviewedDigestDiff {
  readonly planTaskIds: readonly string[];
  readonly storyIds: readonly string[];
  readonly adrDecisionIds: readonly string[];
  readonly artifactPaths: readonly string[];
}

export type ParsePlanReviewArtifactResult = PlanReviewArtifact | { readonly kind: 'integrity-mismatch' | 'unparseable' };

const INTEGRITY_LINE = /^Integrity: (sha256:[a-f0-9]{64})\r?\n/m;
const JSON_FENCE = /```json\n([\s\S]*?)\n```/;

function sha256(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

function sortedRecord(values: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).sort(([left], [right]) => left.localeCompare(right)));
}

function digestComponents(components: Omit<ReviewedDigest, 'digest'>): ReviewedDigest {
  const normalized = {
    planTaskDigests: sortedRecord(components.planTaskDigests),
    storyDigests: sortedRecord(components.storyDigests),
    adrDecisionDigests: sortedRecord(components.adrDecisionDigests),
    artifactDigests: sortedRecord(components.artifactDigests),
  };
  return { ...normalized, digest: sha256(JSON.stringify(normalized)) };
}

function storySections(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  const matches = [...text.matchAll(/^##\s+Story\s+([A-Za-z0-9._-]+)\b[^\n]*(?:\n|$)/gmi)];
  for (const [index, match] of matches.entries()) {
    const start = match.index!;
    const end = matches[index + 1]?.index ?? text.length;
    result[match[1]!] = text.slice(start, end);
  }
  return result;
}

/** Computes stable identities for exactly the plan-review inputs. */
export function computeReviewedDigest(input: ComputeReviewedDigestInput): ReviewedDigest {
  const titles = parsePlanTaskTitles(input.planText);
  const planTaskDigests = Object.fromEntries([...parsePlanTaskBodies(input.planText)].map(([id, body]) =>
    [id, sha256(`${titles.get(id) ?? ''}\n${body}`)],
  ));
  const storyDigests = Object.fromEntries(Object.entries(storySections(input.storiesText)).map(([id, text]) => [id, sha256(text)]));
  const adrDecisionDigests: Record<string, string> = {};
  for (const [id, section] of Object.entries(selectPlanReviewAdrDecisionSections(input))) adrDecisionDigests[id] = sha256(section);
  const artifactDigests = Object.fromEntries(Object.entries(input.artifactTexts).map(([path, text]) => [path, sha256(text)]));
  return digestComponents({ planTaskDigests, storyDigests, adrDecisionDigests, artifactDigests });
}

function changedKeys(before: Readonly<Record<string, string>>, after: Readonly<Record<string, string>>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((key) => before[key] !== after[key])
    .sort((left, right) => left.localeCompare(right));
}

/** Identifies the smallest review inputs that changed between two rounds. */
export function diffReviewedDigests(before: ReviewedDigest, after: ReviewedDigest): ReviewedDigestDiff {
  return {
    planTaskIds: changedKeys(before.planTaskDigests, after.planTaskDigests),
    storyIds: changedKeys(before.storyDigests, after.storyDigests),
    adrDecisionIds: changedKeys(before.adrDecisionDigests, after.adrDecisionDigests),
    artifactPaths: changedKeys(before.artifactDigests, after.artifactDigests),
  };
}

/** Renders durable review state; the integrity line is excluded from its own hash. */
export function renderPlanReviewArtifact(artifact: PlanReviewArtifact): string {
  const payload = JSON.stringify(artifact, null, 2);
  const prefix = '# Plan review\n\n';
  const suffix = `\n\`\`\`json\n${payload}\n\`\`\`\n`;
  return `${prefix}Integrity: ${sha256(prefix + suffix)}\n${suffix}`;
}

function isArtifact(value: unknown): value is PlanReviewArtifact {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const artifact = value as Record<string, unknown>;
  return Number.isInteger(artifact.round) && (artifact.round as number) > 0 &&
    typeof artifact.authoringHost === 'string' && typeof artifact.reviewerProvider === 'string' &&
    ['cross-provider', 'same-provider', 'unknown-host'].includes(artifact.independence as string) &&
    Array.isArray(artifact.findings) && Array.isArray(artifact.dispositions) &&
    typeof artifact.reviewedDigest === 'object' && artifact.reviewedDigest !== null;
}

/** Parses only primitive-rendered artifacts and distinguishes tampering from malformed content. */
export function parsePlanReviewArtifact(text: string): ParsePlanReviewArtifactResult {
  const integrity = text.match(INTEGRITY_LINE);
  const payload = text.match(JSON_FENCE);
  if (!integrity || !payload) return { kind: 'unparseable' };
  const withoutIntegrity = text.replace(INTEGRITY_LINE, '');
  if (sha256(withoutIntegrity) !== integrity[1]) return { kind: 'integrity-mismatch' };
  try {
    const parsed: unknown = JSON.parse(payload[1]!);
    return isArtifact(parsed) ? parsed : { kind: 'unparseable' };
  } catch {
    return { kind: 'unparseable' };
  }
}
