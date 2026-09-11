import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { fileIsFreshSinceSession } from './artifacts.js';

const REMEDIATION_CASE_ARTIFACT_PATH = '.pipeline/remediation.json';
const MAX_CASE_ROWS = 128;
const MAX_SOURCE_ROWS = 512;
const MAX_REFERENCE_LENGTH = 256;
const MAX_TEXT_LENGTH = 8_000;
const MAX_ACTION_TASKS = 32;
const MAX_REFUTATION_ASSERTIONS = 16;
const MAX_REFUTATION_EVIDENCE = 8;

export type RemediationCaseDomain = 'build_review';
export type RemediationCaseSourceOutcome = 'acted' | 'deferred' | 'rejected' | 'refuted' | 'merged';
export type RemediationCaseDisposition = 'act' | 'defer' | 'reject' | 'refute';
export type RemediationCasePriority = 'critical' | 'high' | 'medium' | 'low';
export type RemediationCaseConfidence = 'high' | 'medium' | 'low';

export interface RemediationCaseSourceRow {
  readonly sourceId: string;
  readonly outcome: RemediationCaseSourceOutcome;
  readonly caseRef: string;
}

export interface RemediationCaseActionEffect {
  readonly kind: 'action';
  readonly route: 'build';
  readonly tasks: readonly { readonly title: string }[];
}

export interface RemediationCaseDeferralEffect {
  readonly kind: 'deferral';
  readonly title: string;
  readonly body: string;
  readonly exclusionRationale: string;
}

export interface RemediationCaseNoEffect {
  readonly kind: 'none';
}

export type RemediationCaseEffect =
  | RemediationCaseActionEffect
  | RemediationCaseDeferralEffect
  | RemediationCaseNoEffect;

export interface RemediationCaseRefutationEvidence {
  readonly path: string;
  readonly excerpt: string;
}

export interface RemediationCaseRefutationAssertion {
  readonly assertion: string;
  readonly verdict: 'refuted' | 'upheld';
  readonly evidence: readonly RemediationCaseRefutationEvidence[];
}

export interface RemediationCaseRefutation {
  readonly claim: string;
  readonly assertions: readonly RemediationCaseRefutationAssertion[];
}

export interface RemediationCaseRow {
  readonly caseRef: string;
  readonly existingCaseId?: string;
  readonly disposition: RemediationCaseDisposition;
  readonly priority: RemediationCasePriority;
  readonly rationale: string;
  readonly confidence: RemediationCaseConfidence;
  readonly effect: RemediationCaseEffect;
  readonly refutation?: RemediationCaseRefutation;
}

export interface RemediationCaseJudgement {
  readonly mode: 'case-v1';
  readonly domain: RemediationCaseDomain;
  readonly sourceOutcomes: readonly RemediationCaseSourceRow[];
  readonly cases: readonly RemediationCaseRow[];
}

export type RemediationCaseArtifactRejection =
  | 'missing-or-stale-artifact'
  | 'invalid-json'
  | 'invalid-top-level-keys'
  | 'unknown-mode'
  | 'unknown-domain'
  | 'invalid-source-keys'
  | 'invalid-source-outcome'
  | 'invalid-case-keys'
  | 'invalid-case-disposition'
  | 'invalid-case-priority'
  | 'invalid-case-confidence'
  | 'invalid-action-effect'
  | 'invalid-deferral-effect'
  | 'invalid-reject-effect'
  | 'invalid-refute-effect'
  | 'invalid-refutation'
  | 'malformed-refutation-evidence';

export type ReadRemediationCaseJudgementResult =
  | { readonly ok: true; readonly judgement: RemediationCaseJudgement }
  | { readonly ok: false; readonly reason: RemediationCaseArtifactRejection };

type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: RemediationCaseArtifactRejection };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function isBoundedString(value: unknown, maxLength = MAX_TEXT_LENGTH): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function parseSourceRow(value: unknown): ParseResult<RemediationCaseSourceRow> {
  if (!isRecord(value) || !hasExactKeys(value, ['sourceId', 'outcome', 'caseRef'])) {
    return { ok: false, reason: 'invalid-source-keys' };
  }
  if (!isBoundedString(value.sourceId, MAX_REFERENCE_LENGTH) || !isBoundedString(value.caseRef, MAX_REFERENCE_LENGTH)) {
    return { ok: false, reason: 'invalid-source-keys' };
  }
  if (!oneOf(value.outcome, ['acted', 'deferred', 'rejected', 'refuted', 'merged'] as const)) {
    return { ok: false, reason: 'invalid-source-outcome' };
  }
  return { ok: true, value: { sourceId: value.sourceId, outcome: value.outcome, caseRef: value.caseRef } };
}

function parseEffect(value: unknown, disposition: RemediationCaseDisposition): ParseResult<RemediationCaseEffect> {
  if (!isRecord(value)) return { ok: false, reason: disposition === 'act' ? 'invalid-action-effect' : disposition === 'defer' ? 'invalid-deferral-effect' : disposition === 'refute' ? 'invalid-refute-effect' : 'invalid-reject-effect' };
  if (disposition === 'act') {
    if (!hasExactKeys(value, ['kind', 'route', 'tasks']) || value.kind !== 'action' || value.route !== 'build' || !Array.isArray(value.tasks) || value.tasks.length === 0 || value.tasks.length > MAX_ACTION_TASKS) {
      return { ok: false, reason: 'invalid-action-effect' };
    }
    const tasks: { title: string }[] = [];
    for (const task of value.tasks) {
      if (!isRecord(task) || !hasExactKeys(task, ['title']) || !isBoundedString(task.title)) {
        return { ok: false, reason: 'invalid-action-effect' };
      }
      tasks.push({ title: task.title });
    }
    return { ok: true, value: { kind: 'action', route: 'build', tasks } };
  }
  if (disposition === 'defer' || disposition === 'refute') {
    if (disposition === 'refute' && hasExactKeys(value, ['kind']) && value.kind === 'none') {
      return { ok: true, value: { kind: 'none' } };
    }
    if (!hasExactKeys(value, ['kind', 'title', 'body', 'exclusionRationale']) || value.kind !== 'deferral' || !isBoundedString(value.title) || !isBoundedString(value.body) || !isBoundedString(value.exclusionRationale)) {
      // Keep parser vocabulary aligned with graph validation: a refute row
      // proposing a deferral has deferral-shaped invalidity, even when one of
      // its required fields is absent or empty. Other non-none refute effects
      // remain invalid refute effects.
      return { ok: false, reason: disposition === 'refute' && value.kind === 'deferral' ? 'invalid-deferral-effect' : disposition === 'refute' ? 'invalid-refute-effect' : 'invalid-deferral-effect' };
    }
    return {
      ok: true,
      value: {
        kind: 'deferral',
        title: value.title,
        body: value.body,
        exclusionRationale: value.exclusionRationale,
      },
    };
  }
  return hasExactKeys(value, ['kind']) && value.kind === 'none'
    ? { ok: true, value: { kind: 'none' } }
    : { ok: false, reason: 'invalid-reject-effect' };
}

function parseRefutation(value: unknown): ParseResult<RemediationCaseRefutation> {
  if (!isRecord(value) || !hasExactKeys(value, ['claim', 'assertions']) || !isBoundedString(value.claim) || !Array.isArray(value.assertions) || value.assertions.length === 0 || value.assertions.length > MAX_REFUTATION_ASSERTIONS) {
    return { ok: false, reason: 'invalid-refutation' };
  }
  const assertions: RemediationCaseRefutationAssertion[] = [];
  for (const assertion of value.assertions) {
    if (!isRecord(assertion) || !hasExactKeys(assertion, ['assertion', 'verdict', 'evidence']) || !isBoundedString(assertion.assertion) || !oneOf(assertion.verdict, ['refuted', 'upheld'] as const) || !Array.isArray(assertion.evidence) || assertion.evidence.length === 0 || assertion.evidence.length > MAX_REFUTATION_EVIDENCE) {
      return { ok: false, reason: 'invalid-refutation' };
    }
    const evidence: RemediationCaseRefutationEvidence[] = [];
    for (const entry of assertion.evidence) {
      if (!isRecord(entry) || !hasExactKeys(entry, ['path', 'excerpt']) || !isBoundedString(entry.path, MAX_REFERENCE_LENGTH) || !isBoundedString(entry.excerpt)) {
        return { ok: false, reason: 'malformed-refutation-evidence' };
      }
      evidence.push({ path: entry.path, excerpt: entry.excerpt });
    }
    assertions.push({ assertion: assertion.assertion, verdict: assertion.verdict, evidence });
  }
  return { ok: true, value: { claim: value.claim, assertions } };
}

function parseCaseRow(value: unknown): ParseResult<RemediationCaseRow> {
  if (!isRecord(value)) return { ok: false, reason: 'invalid-case-keys' };
  if (!oneOf(value.disposition, ['act', 'defer', 'reject', 'refute'] as const)) {
    return { ok: false, reason: 'invalid-case-disposition' };
  }
  if (value.disposition === 'refute' && value.refutation === undefined) {
    return { ok: false, reason: 'invalid-refutation' };
  }
  const keys = value.disposition === 'refute'
    ? value.existingCaseId === undefined
      ? ['caseRef', 'disposition', 'priority', 'rationale', 'confidence', 'effect', 'refutation']
      : ['caseRef', 'existingCaseId', 'disposition', 'priority', 'rationale', 'confidence', 'effect', 'refutation']
    : value.existingCaseId === undefined
    ? ['caseRef', 'disposition', 'priority', 'rationale', 'confidence', 'effect']
    : ['caseRef', 'existingCaseId', 'disposition', 'priority', 'rationale', 'confidence', 'effect'];
  if (!hasExactKeys(value, keys) || !isBoundedString(value.caseRef, MAX_REFERENCE_LENGTH) || (value.existingCaseId !== undefined && !isBoundedString(value.existingCaseId, MAX_REFERENCE_LENGTH)) || !isBoundedString(value.rationale)) {
    return { ok: false, reason: 'invalid-case-keys' };
  }
  if (!oneOf(value.priority, ['critical', 'high', 'medium', 'low'] as const)) {
    return { ok: false, reason: 'invalid-case-priority' };
  }
  if (!oneOf(value.confidence, ['high', 'medium', 'low'] as const)) {
    return { ok: false, reason: 'invalid-case-confidence' };
  }
  const effect = parseEffect(value.effect, value.disposition);
  if (!effect.ok) return effect;
  const refutation = value.disposition === 'refute' ? parseRefutation(value.refutation) : undefined;
  if (refutation !== undefined && !refutation.ok) return refutation;
  return {
    ok: true,
    value: {
      caseRef: value.caseRef,
      ...(value.existingCaseId === undefined ? {} : { existingCaseId: value.existingCaseId }),
      disposition: value.disposition,
      priority: value.priority,
      rationale: value.rationale,
      confidence: value.confidence,
      effect: effect.value,
      ...(refutation === undefined ? {} : { refutation: refutation.value }),
    },
  };
}

function parseRemediationCaseJudgement(value: unknown): ParseResult<RemediationCaseJudgement> {
  if (!isRecord(value) || !hasExactKeys(value, ['mode', 'domain', 'sourceOutcomes', 'cases'])) {
    return { ok: false, reason: 'invalid-top-level-keys' };
  }
  if (value.mode !== 'case-v1') return { ok: false, reason: 'unknown-mode' };
  if (value.domain !== 'build_review') return { ok: false, reason: 'unknown-domain' };
  if (!Array.isArray(value.sourceOutcomes) || value.sourceOutcomes.length > MAX_SOURCE_ROWS || !Array.isArray(value.cases) || value.cases.length > MAX_CASE_ROWS) {
    return { ok: false, reason: 'invalid-top-level-keys' };
  }
  const sourceOutcomes: RemediationCaseSourceRow[] = [];
  for (const source of value.sourceOutcomes) {
    const parsed = parseSourceRow(source);
    if (!parsed.ok) return parsed;
    sourceOutcomes.push(parsed.value);
  }
  const cases: RemediationCaseRow[] = [];
  for (const judgement of value.cases) {
    const parsed = parseCaseRow(judgement);
    if (!parsed.ok) return parsed;
    cases.push(parsed.value);
  }
  return { ok: true, value: { mode: 'case-v1', domain: 'build_review', sourceOutcomes, cases } };
}

/**
 * Reads only the additive case-mode remediation result. Legacy remediation
 * artifacts remain owned by `readRemediationPlan` in `artifacts.ts`.
 */
export async function readRemediationCaseJudgement(
  projectRoot: string,
  sessionStartedAt: number | undefined,
): Promise<ReadRemediationCaseJudgementResult> {
  const path = join(projectRoot, REMEDIATION_CASE_ARTIFACT_PATH);
  if (!(await fileIsFreshSinceSession(path, sessionStartedAt))) {
    return { ok: false, reason: 'missing-or-stale-artifact' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }
  const result = parseRemediationCaseJudgement(parsed);
  return result.ok ? { ok: true, judgement: result.value } : result;
}
