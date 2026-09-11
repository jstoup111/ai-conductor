import type { ExecutionContext, ExecutionSubject } from '../types/events.js';
import type { StepName } from '../types/steps.js';
import { ALL_STEPS, OUT_OF_BAND_STEPS } from './steps.js';

const lifecycleStepNames = new Set([
  ...ALL_STEPS.map(({ name }) => name),
  ...Object.keys(OUT_OF_BAND_STEPS),
]);

/** The feature dispatch and run that bound a correlation namespace. */
export interface ExecutionScope {
  featureId: string;
  runId: string;
}

/** Input to the shared event-identity resolver. */
export interface ExecutionIdentityInput {
  scope: ExecutionScope;
  /** Event readers retain unknown historical labels without casting them into StepName. */
  legacyStep: string;
  /** `undefined` denotes a historical/context-free record; any other malformed value is rejected. */
  executionContext?: unknown;
}

/** Correlation bookkeeping plus the bounded label safe for display and metrics. */
export interface ResolvedExecutionIdentity {
  correlationKey: string;
  subjectLabel: string;
  metricLabel: string;
}

/**
 * Resolves a single execution identity without deriving policy identity from a
 * configured member name. Context-free events live in an explicit legacy
 * namespace; malformed explicit context never joins that namespace.
 */
export function resolveExecutionIdentity(
  input: ExecutionIdentityInput,
): ResolvedExecutionIdentity | undefined {
  if (!isExecutionScope(input.scope) || !isNonEmptyString(input.legacyStep)) return undefined;

  if (input.executionContext === undefined) {
    return resolveLegacyExecutionIdentity(input.scope, input.legacyStep);
  }

  if (!isExecutionContext(input.executionContext)) return undefined;
  if (
    input.executionContext.subject.kind === 'lifecycle-step'
    && input.executionContext.subject.step !== input.legacyStep
  ) return undefined;

  const subjectLabel = subjectLabelFor(input.executionContext.subject);
  return {
    correlationKey: correlationKey(
      'execution',
      input.scope.featureId,
      input.scope.runId,
      input.executionContext.executionId,
      ...subjectKeyParts(input.executionContext.subject),
    ),
    subjectLabel,
    metricLabel: subjectLabel,
  };
}

function resolveLegacyExecutionIdentity(
  scope: ExecutionScope,
  legacyStep: string,
): ResolvedExecutionIdentity {
  return {
    correlationKey: correlationKey('legacy', scope.featureId, scope.runId, legacyStep),
    subjectLabel: legacyStep,
    metricLabel: legacyStep,
  };
}

function subjectLabelFor(subject: ExecutionSubject): string {
  if (subject.kind === 'lifecycle-step') return subject.step;
  return `configured:${escapeLabelComponent(subject.parentGroup)}/${escapeLabelComponent(subject.member)}`;
}

function subjectKeyParts(subject: ExecutionSubject): readonly string[] {
  return subject.kind === 'lifecycle-step'
    ? [subject.kind, subject.step]
    : [subject.kind, subject.parentGroup, subject.member];
}

function correlationKey(namespace: 'execution' | 'legacy', ...parts: readonly string[]): string {
  return `${namespace}\0${JSON.stringify(parts)}`;
}

function escapeLabelComponent(component: string): string {
  return encodeURIComponent(component);
}

function isExecutionScope(value: ExecutionScope): boolean {
  return isNonEmptyString(value.featureId) && isNonEmptyString(value.runId);
}

function isExecutionContext(value: unknown): value is ExecutionContext {
  if (!isRecord(value) || !isNonEmptyString(value.executionId)) return false;
  return isExecutionSubject(value.subject);
}

function isExecutionSubject(value: unknown): value is ExecutionSubject {
  if (!isRecord(value) || typeof value.kind !== 'string') return false;
  if (value.kind === 'lifecycle-step') return isLifecycleStep(value.step);
  return value.kind === 'configured-member'
    && isNonEmptyString(value.parentGroup)
    && isNonEmptyString(value.member);
}

function isLifecycleStep(value: unknown): value is StepName {
  return typeof value === 'string' && lifecycleStepNames.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
