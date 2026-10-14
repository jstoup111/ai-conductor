/** The closed provider result contract for source-grounded plan review. */
export const PLAN_REVIEW_SEVERITIES = ['blocking', 'significant', 'advisory'] as const;
export const PLAN_REVIEW_LENSES = [
  'test-impact', 'reachability', 'dependency-order', 'feasibility', 'contradiction',
] as const;

export type PlanReviewSeverity = typeof PLAN_REVIEW_SEVERITIES[number];
export type PlanReviewLens = typeof PLAN_REVIEW_LENSES[number];

export interface PlanReviewFinding {
  readonly id: string;
  readonly severity: PlanReviewSeverity;
  readonly lens: PlanReviewLens;
  readonly artifact: string;
  readonly reference: string;
  readonly relatedReference: string | null;
  readonly resolvesPrior: string | null;
  readonly summary: string;
  readonly evidence: readonly string[];
}

export interface PlanReviewResult {
  readonly findings: readonly PlanReviewFinding[];
}

export interface PlanReviewValidationContext {
  readonly planText: string;
  readonly storiesText: string;
  readonly adrTexts: Readonly<Record<string, string>>;
  /** Worktree-relative paths and their current text. */
  readonly sourceFiles: Readonly<Record<string, string>>;
}

export type ValidatePlanReviewResult =
  | { readonly kind: 'accepted'; readonly result: PlanReviewResult }
  | { readonly kind: 'rejected'; readonly diagnostics: readonly string[] };

const NON_BLANK_STRING = { type: 'string', minLength: 1 } as const;
const NULLABLE_STRING = { anyOf: [NON_BLANK_STRING, { type: 'null' }] } as const;

const findingSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'severity', 'lens', 'artifact', 'reference', 'relatedReference', 'resolvesPrior', 'summary', 'evidence'],
  properties: {
    id: NON_BLANK_STRING,
    severity: { type: 'string', enum: PLAN_REVIEW_SEVERITIES },
    lens: { type: 'string', enum: PLAN_REVIEW_LENSES },
    artifact: NON_BLANK_STRING,
    reference: NON_BLANK_STRING,
    relatedReference: NULLABLE_STRING,
    resolvesPrior: NULLABLE_STRING,
    summary: NON_BLANK_STRING,
    evidence: { type: 'array', minItems: 1, items: NON_BLANK_STRING },
  },
} as const;

/** Engine-owned schema passed unchanged to all provider-native schema adapters. */
export const PLAN_REVIEW_RESULT_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['findings'],
  properties: { findings: { type: 'array', items: findingSchema } },
} as const);

function deepFreeze<Value>(value: Value): Value {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function isReference(value: string): boolean {
  return /^task\s+\S+$/i.test(value) || /^story\s+\S+$/i.test(value) || /^S[A-Za-z0-9.-]+$/.test(value) ||
    /^[a-z0-9][a-z0-9-]*#D\d+$/i.test(value);
}

function evidenceLocation(value: string, sourceFiles: Readonly<Record<string, string>>): string | undefined {
  const match = /(^|\s)([^\s:]+):(\d+)\b/.exec(value);
  if (match === null) return undefined;
  const path = match[2]!;
  const line = Number(match[3]);
  if (!Number.isSafeInteger(line) || line < 1 || sourceFiles[path] === undefined) return undefined;
  return path;
}

function quotedPassages(evidence: readonly string[]): readonly string[] {
  return evidence.flatMap((entry) => [...entry.matchAll(/"([^"\n]+)"/g)].map((match) => match[1]!));
}

function hasTwoGroundedQuotes(evidence: readonly string[], context: PlanReviewValidationContext): boolean {
  const searchable = [context.planText, context.storiesText, ...Object.values(context.adrTexts), ...Object.values(context.sourceFiles)];
  return quotedPassages(evidence).filter((passage) => searchable.some((text) => text.includes(passage))).length >= 2;
}

function hasDependencyClosureEvidence(evidence: readonly string[], reference: string, relatedReference: string | null): boolean {
  if (!nonEmptyText(relatedReference)) return false;
  const taskReference = reference.toLowerCase();
  const relatedTaskReference = relatedReference.toLowerCase();
  return evidence.some((entry) => {
    const normalized = entry.toLowerCase();
    return normalized.includes('dependency closure') &&
      normalized.includes(taskReference) &&
      normalized.includes(relatedTaskReference) &&
      /\bnot reachable\b|\boutside (?:the )?dependency closure\b/.test(normalized);
  });
}

function validateFinding(value: unknown, index: number, context: PlanReviewValidationContext, diagnostics: string[]): PlanReviewFinding | undefined {
  const field = `findings[${index}]`;
  const keys = ['id', 'severity', 'lens', 'artifact', 'reference', 'relatedReference', 'resolvesPrior', 'summary', 'evidence'];
  if (!record(value) || !exactKeys(value, keys)) {
    diagnostics.push(`${field} must contain exactly the plan-review finding fields`);
    return undefined;
  }
  const id = nonEmptyText(value.id) ? value.id : field;
  if (!nonEmptyText(value.id)) diagnostics.push(`${field}.id must be non-empty`);
  if (!(typeof value.severity === 'string' && (PLAN_REVIEW_SEVERITIES as readonly string[]).includes(value.severity))) {
    diagnostics.push(`${id}.severity must be one of ${PLAN_REVIEW_SEVERITIES.join(', ')}`);
  }
  if (!(typeof value.lens === 'string' && (PLAN_REVIEW_LENSES as readonly string[]).includes(value.lens))) {
    diagnostics.push(`${id}.lens must be one of ${PLAN_REVIEW_LENSES.join(', ')}`);
  }
  if (!nonEmptyText(value.artifact) || !value.artifact.startsWith('.docs/')) diagnostics.push(`${id}.artifact must be a .docs artifact path`);
  if (!nonEmptyText(value.reference) || !isReference(value.reference)) diagnostics.push(`${id}.reference must name a task, story, or ADR decision`);
  if (!(value.relatedReference === null || nonEmptyText(value.relatedReference))) diagnostics.push(`${id}.relatedReference must be a string or null`);
  if (!(value.resolvesPrior === null || nonEmptyText(value.resolvesPrior))) diagnostics.push(`${id}.resolvesPrior must be a string or null`);
  if (!nonEmptyText(value.summary)) diagnostics.push(`${id}.summary must be non-empty`);
  if (!Array.isArray(value.evidence) || !value.evidence.every(nonEmptyText)) {
    diagnostics.push(`${id}.evidence must be a non-empty array of evidence text`);
  } else {
    const artifactEvidence = value.evidence.some((entry) => evidenceLocation(entry, context.sourceFiles) !== undefined);
    const requiresSourceEvidence = value.lens === 'test-impact' || value.lens === 'feasibility';
    const sourceEvidence = value.evidence.some((entry) => {
      const path = evidenceLocation(entry, context.sourceFiles);
      return path !== undefined && !path.startsWith('.docs/');
    });
    if (!(requiresSourceEvidence ? sourceEvidence : artifactEvidence)) {
      diagnostics.push(`${id}.evidence requires a ${requiresSourceEvidence ? 'worktree source' : 'worktree artifact'} file:line`);
    }
    if (value.lens === 'contradiction' && !hasTwoGroundedQuotes(value.evidence, context)) {
      diagnostics.push(`${id}.evidence requires two quoted passages grounded in the reviewed artifacts or source`);
    }
  }
  if (value.lens === 'dependency-order' && (!nonEmptyText(value.relatedReference) || !/^task\s+\S+$/i.test(value.relatedReference) || value.relatedReference === value.reference)) {
    diagnostics.push(`${id}.relatedReference must name a second task for dependency-order`);
  }
  if (value.lens === 'dependency-order' && Array.isArray(value.evidence) &&
    !hasDependencyClosureEvidence(value.evidence as readonly string[], value.reference as string, value.relatedReference as string | null)) {
    diagnostics.push(`${id}.evidence requires dependency-closure evidence naming both tasks and showing the related task is not reachable`);
  }
  if (diagnostics.some((diagnostic) => diagnostic.startsWith(`${id}.`) || diagnostic.startsWith(`${field}.`))) return undefined;
  return value as unknown as PlanReviewFinding;
}

/** Validates provider output and rejects findings lacking lens-specific source evidence. */
export function validatePlanReviewResult(value: unknown, context: PlanReviewValidationContext): ValidatePlanReviewResult {
  if (!record(value) || !exactKeys(value, ['findings']) || !Array.isArray(value.findings)) {
    return { kind: 'rejected', diagnostics: ['result must contain exactly a findings array'] };
  }
  const diagnostics: string[] = [];
  const findings = value.findings.map((finding, index) => validateFinding(finding, index, context, diagnostics));
  return diagnostics.length === 0
    ? { kind: 'accepted', result: { findings: findings as PlanReviewFinding[] } }
    : { kind: 'rejected', diagnostics };
}
