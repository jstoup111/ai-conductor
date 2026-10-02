import { normalizePlanTaskId, resolvePlanTaskReference } from './plan-task-parse.js';

/** The versioned, engine-owned output contract for PRD-audit judgments. */
export const PRD_AUDIT_JUDGMENT_CONTRACT_VERSION = 'v1' as const;

export const PRD_AUDIT_JUDGMENT_GRADES = ['PASS', 'FIXABLE', 'PLAN_GAP', 'OVER_SCOPE'] as const;
export type PrdAuditJudgmentGrade = typeof PRD_AUDIT_JUDGMENT_GRADES[number];
export type PrdAuditIntentRelation = 'within' | 'outside-harmless' | 'outside-visible';

export interface PrdAuditCriterionReference {
  readonly storyId: string;
  readonly ordinal: number;
}

export interface PrdAuditRequirementAssociation {
  readonly path: string;
  readonly requirementId: string;
}

export interface PrdAuditCriterionJudgment {
  readonly criterion: PrdAuditCriterionReference;
  /** Canonical, active criterion id added by the engine after resolution. */
  readonly criterionId: string;
  readonly grade: PrdAuditJudgmentGrade;
  readonly evidence: string;
  readonly rationale: string;
  readonly requirementAssociations: readonly PrdAuditRequirementAssociation[];
  readonly evidenceTaskIds: readonly string[];
  readonly ownerTaskId?: string;
  readonly intentRelation?: PrdAuditIntentRelation;
}

export interface PrdAuditNoOwnerObservation {
  readonly presentationOrdinal: string;
  readonly grade: 'OVER_SCOPE';
  readonly evidence: string;
  readonly rationale: string;
  readonly intentRelation: PrdAuditIntentRelation;
}

export interface PrdAuditJudgment {
  readonly version: typeof PRD_AUDIT_JUDGMENT_CONTRACT_VERSION;
  readonly criterionJudgments: readonly PrdAuditCriterionJudgment[];
  readonly noOwnerObservations: readonly PrdAuditNoOwnerObservation[];
}

/** The independently resolved, feature-scoped references a reviewer may cite. */
export interface PrdAuditJudgmentContext {
  readonly criteria: readonly { readonly id: string }[];
  readonly requirements: readonly (
    | { readonly path: string; readonly requirementId: string }
    | { readonly path: string; readonly id: string }
    | { readonly path: string; readonly requirements: readonly { readonly id: string }[] }
  )[];
  /** Canonical active task ids. `tasks` is retained for projection-shaped callers. */
  readonly activeTaskIds?: ReadonlySet<string> | readonly string[];
  /** Compatibility alias for callers that already hold the active-id set. */
  readonly taskIds?: ReadonlySet<string> | readonly string[];
  readonly tasks?: readonly { readonly id: string }[];
}

export type ValidatePrdAuditJudgmentResult =
  | { readonly ok: true; readonly judgment: PrdAuditJudgment }
  | { readonly ok: false; readonly judgment?: PrdAuditJudgment; readonly diagnostics: readonly string[] };

const NON_BLANK_STRING = { type: 'string', minLength: 1 } as const;
const INTENT_RELATIONS = ['within', 'outside-harmless', 'outside-visible'] as const;

const criterionReferenceSchema = {
  type: 'object', additionalProperties: false, required: ['storyId', 'ordinal'],
  properties: { storyId: NON_BLANK_STRING, ordinal: { type: 'integer', minimum: 1 } },
} as const;

const requirementAssociationSchema = {
  type: 'object', additionalProperties: false, required: ['path', 'requirementId'],
  properties: { path: NON_BLANK_STRING, requirementId: NON_BLANK_STRING },
} as const;

const baseCriterionProperties = {
  criterion: criterionReferenceSchema,
  grade: { type: 'string', enum: PRD_AUDIT_JUDGMENT_GRADES },
  evidence: NON_BLANK_STRING,
  rationale: NON_BLANK_STRING,
  requirementAssociations: { type: 'array', items: requirementAssociationSchema },
  evidenceTaskIds: { type: 'array', items: NON_BLANK_STRING },
  ownerTaskId: NON_BLANK_STRING,
  intentRelation: { type: 'string', enum: INTENT_RELATIONS },
} as const;

function criterionBranch(
  grade: PrdAuditJudgmentGrade,
  optional: readonly ('ownerTaskId' | 'intentRelation')[] = [],
) {
  const required = ['criterion', 'grade', 'evidence', 'rationale', 'requirementAssociations', 'evidenceTaskIds'] as string[];
  if (!optional.includes('ownerTaskId') && grade === 'FIXABLE') required.push('ownerTaskId');
  if (!optional.includes('intentRelation') && grade === 'OVER_SCOPE') required.push('intentRelation');
  const properties = {
    ...baseCriterionProperties,
    grade: { const: grade },
  };
  const permitted = Object.fromEntries(Object.entries(properties).filter(([key]) =>
    !((key === 'ownerTaskId' && grade !== 'FIXABLE') || (key === 'intentRelation' && grade !== 'OVER_SCOPE')),
  ));
  return { type: 'object', additionalProperties: false, required, properties: permitted } as const;
}

const noOwnerProperties = {
  grade: { const: 'OVER_SCOPE' },
  evidence: NON_BLANK_STRING,
  rationale: NON_BLANK_STRING,
  intentRelation: { type: 'string', enum: INTENT_RELATIONS },
} as const;

/** Engine-owned schema passed unchanged to provider-native schema adapters. */
export const PRD_AUDIT_JUDGMENT_SCHEMA = deepFreeze({
  type: 'object', additionalProperties: false,
  required: ['version', 'criterionJudgments', 'noOwnerObservations'],
  properties: {
    version: { const: PRD_AUDIT_JUDGMENT_CONTRACT_VERSION },
    criterionJudgments: {
      type: 'array',
      items: { oneOf: [
        criterionBranch('PASS'),
        criterionBranch('FIXABLE'),
        criterionBranch('PLAN_GAP'),
        criterionBranch('OVER_SCOPE'),
      ] },
    },
    noOwnerObservations: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['grade', 'evidence', 'rationale', 'intentRelation'],
        properties: noOwnerProperties,
      },
    },
  },
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

/** Render the provider-visible result shape by walking any JSON Schema object. */
export function renderPrdAuditJudgmentShape(schema: unknown): string {
  if (!record(schema)) return 'unknown';
  if (Array.isArray(schema.enum)) return `one of ${schema.enum.map((value) => JSON.stringify(value)).join(', ')}`;
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (Array.isArray(schema.oneOf)) return schema.oneOf.map((alternative) => renderPrdAuditJudgmentShape(alternative)).join(' | ');
  if (schema.type === 'array') return `array of ${renderPrdAuditJudgmentShape(schema.items)}`;
  if (schema.type === 'object' || record(schema.properties)) {
    const properties = record(schema.properties) ? schema.properties : {};
    return `{ ${Object.entries(properties).map(([name, property]) =>
      `\`${name}\`: ${renderPrdAuditJudgmentShape(property)}`).join(', ')} }`;
  }
  return typeof schema.type === 'string' ? schema.type : 'unknown';
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function isGrade(value: unknown): value is PrdAuditJudgmentGrade {
  return typeof value === 'string' && (PRD_AUDIT_JUDGMENT_GRADES as readonly string[]).includes(value);
}

function isIntentRelation(value: unknown): value is PrdAuditIntentRelation {
  return typeof value === 'string' && (INTENT_RELATIONS as readonly string[]).includes(value);
}

function criterionId(reference: PrdAuditCriterionReference): string {
  return `S${reference.storyId}.${reference.ordinal}`;
}

function activeTaskIds(context: PrdAuditJudgmentContext): ReadonlySet<string> {
  const ids = context.activeTaskIds ?? context.taskIds ?? context.tasks?.map((task) => task.id) ?? [];
  return new Set(Array.from(ids, normalizePlanTaskId));
}

function requirementKeys(context: PrdAuditJudgmentContext): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const source of context.requirements) {
    if ('requirements' in source) {
      for (const requirement of source.requirements) keys.add(`${source.path}\u0000${requirement.id}`);
    } else {
      keys.add(`${source.path}\u0000${'requirementId' in source ? source.requirementId : source.id}`);
    }
  }
  return keys;
}

function parseAssociations(value: unknown, field: string, requirements: ReadonlySet<string>, diagnostics: string[]): PrdAuditRequirementAssociation[] | undefined {
  if (!Array.isArray(value)) {
    diagnostics.push(`${field} must be an array of path-qualified requirement associations`);
    return undefined;
  }
  const associations: PrdAuditRequirementAssociation[] = [];
  let invalid = false;
  for (const [index, entry] of value.entries()) {
    const entryField = `${field}[${index}]`;
    if (!record(entry) || !exactKeys(entry, ['path', 'requirementId']) || !nonEmptyText(entry.path) || !nonEmptyText(entry.requirementId)) {
      diagnostics.push(`${entryField} requires exactly non-empty path and requirementId`);
      invalid = true;
      continue;
    }
    if (!requirements.has(`${entry.path}\u0000${entry.requirementId}`)) {
      diagnostics.push(`${entryField} does not resolve requirement ${entry.path}:${entry.requirementId}`);
      invalid = true;
      continue;
    }
    associations.push({ path: entry.path, requirementId: entry.requirementId });
  }
  return invalid ? undefined : associations;
}

function parseEvidenceTaskIds(value: unknown, field: string, taskIds: ReadonlySet<string>, diagnostics: string[]): string[] | undefined {
  if (!Array.isArray(value) || !value.every(nonEmptyText)) {
    diagnostics.push(`${field} must be an array of non-empty task ids`);
    return undefined;
  }
  const resolved: string[] = [];
  let invalid = false;
  for (const [index, raw] of value.entries()) {
    const resolution = resolvePlanTaskReference(raw, taskIds);
    if (resolution.kind !== 'resolved') {
      diagnostics.push(`${field}[${index}] ${resolution.kind === 'unresolvable' ? `does not resolve active task ${resolution.ids.join(', ')}` : 'must use the shared active-plan task-id grammar'}`);
      invalid = true;
      continue;
    }
    for (const id of resolution.ids) if (!resolved.includes(id)) resolved.push(id);
  }
  return invalid ? undefined : resolved;
}

function parseCriterionReference(value: unknown, field: string, criteria: ReadonlyMap<string, string>, diagnostics: string[]): { reference: PrdAuditCriterionReference; id: string } | undefined {
  if (!record(value) || !exactKeys(value, ['storyId', 'ordinal']) || !nonEmptyText(value.storyId) ||
    typeof value.ordinal !== 'number' || !Number.isInteger(value.ordinal) || value.ordinal < 1) {
    diagnostics.push(`${field} requires exactly non-empty storyId and positive whole-number ordinal`);
    return undefined;
  }
  const reference = { storyId: value.storyId, ordinal: value.ordinal };
  const id = criteria.get(criterionId(reference).toLowerCase());
  if (id === undefined) {
    diagnostics.push(`${field} does not resolve active criterion ${criterionId(reference)}`);
    return undefined;
  }
  return { reference, id };
}

function validBase(value: Record<string, unknown>, field: string, diagnostics: string[]): value is Record<string, unknown> & {
  evidence: string; rationale: string; grade: PrdAuditJudgmentGrade;
} {
  if (!isGrade(value.grade)) {
    diagnostics.push(`${field}.grade must be one of ${PRD_AUDIT_JUDGMENT_GRADES.join(', ')}`);
    return false;
  }
  if (!nonEmptyText(value.evidence)) {
    diagnostics.push(`${field}.evidence must be non-empty`);
    return false;
  }
  if (!nonEmptyText(value.rationale)) {
    diagnostics.push(`${field}.rationale must be non-empty`);
    return false;
  }
  return true;
}

/**
 * Validate a provider's terminal structured result and resolve every reference against the
 * independently prepared feature context. The engine, never the reviewer, adds display IDs.
 */
export function validatePrdAuditJudgment(input: unknown, context: PrdAuditJudgmentContext): ValidatePrdAuditJudgmentResult {
  const diagnostics: string[] = [];
  if (!record(input)) return { ok: false, diagnostics: ['root must be a judgment object'] };
  const rootKeys = ['version', 'criterionJudgments', 'noOwnerObservations'];
  const reviewerAuthorityRootFields = ['accept', 'refuse', 'engineIdentity', 'codeStamp', 'recordedDisposition'];
  const unsupportedRootFields = Object.keys(input).filter((key) => !rootKeys.includes(key));
  if (unsupportedRootFields.length > 0 && unsupportedRootFields.every((field) => reviewerAuthorityRootFields.includes(field))) {
    return { ok: false, diagnostics: unsupportedRootFields.map((field) =>
      `root.${field} is an unsupported reviewer-supplied authority field`),
    };
  }
  if (!exactKeys(input, rootKeys)) {
    return { ok: false, diagnostics: ['root permits only version, criterionJudgments, and noOwnerObservations'] };
  }
  if (input.version !== PRD_AUDIT_JUDGMENT_CONTRACT_VERSION) {
    return { ok: false, diagnostics: [`version must be ${PRD_AUDIT_JUDGMENT_CONTRACT_VERSION}`] };
  }
  if (!Array.isArray(input.criterionJudgments) || !Array.isArray(input.noOwnerObservations)) {
    return { ok: false, diagnostics: ['criterionJudgments and noOwnerObservations must be arrays'] };
  }

  const criteria = new Map<string, string>();
  for (const criterion of context.criteria) {
    if (nonEmptyText(criterion.id)) criteria.set(criterion.id.toLowerCase(), criterion.id);
  }
  const requirements = requirementKeys(context);
  const taskIds = activeTaskIds(context);
  const criterionJudgments: PrdAuditCriterionJudgment[] = [];
  const criterionJudgmentIndexes: number[] = [];

  for (const [index, raw] of input.criterionJudgments.entries()) {
    const field = `criterionJudgments[${index}]`;
    if (!record(raw) || !validBase(raw, field, diagnostics)) continue;
    const permitted = raw.grade === 'FIXABLE'
      ? ['criterion', 'grade', 'evidence', 'rationale', 'requirementAssociations', 'evidenceTaskIds', 'ownerTaskId']
      : raw.grade === 'OVER_SCOPE'
        ? ['criterion', 'grade', 'evidence', 'rationale', 'requirementAssociations', 'evidenceTaskIds', 'intentRelation']
        : ['criterion', 'grade', 'evidence', 'rationale', 'requirementAssociations', 'evidenceTaskIds'];
    if (!exactKeys(raw, permitted)) {
      diagnostics.push(`${field} has unsupported fields or is missing required fields for grade ${raw.grade}`);
      continue;
    }
    const criterion = parseCriterionReference(raw.criterion, `${field}.criterion`, criteria, diagnostics);
    const associations = parseAssociations(raw.requirementAssociations, `${field}.requirementAssociations`, requirements, diagnostics);
    const evidenceTaskIds = parseEvidenceTaskIds(raw.evidenceTaskIds, `${field}.evidenceTaskIds`, taskIds, diagnostics);
    if (criterion === undefined || associations === undefined || evidenceTaskIds === undefined) continue;
    if (raw.grade === 'FIXABLE') {
      if (!nonEmptyText(raw.ownerTaskId)) {
        diagnostics.push(`${field}.ownerTaskId must identify exactly one active task for FIXABLE`);
        continue;
      }
      const owner = resolvePlanTaskReference(raw.ownerTaskId, taskIds);
      if (owner.kind !== 'resolved' || owner.ids.length !== 1) {
        diagnostics.push(`${field}.ownerTaskId must identify exactly one active task for FIXABLE`);
        continue;
      }
      criterionJudgments.push({ criterion: criterion.reference, criterionId: criterion.id, grade: raw.grade, evidence: raw.evidence,
        rationale: raw.rationale, requirementAssociations: associations, evidenceTaskIds, ownerTaskId: owner.ids[0] });
      criterionJudgmentIndexes.push(index);
      continue;
    }
    if (raw.grade === 'OVER_SCOPE') {
      if (!isIntentRelation(raw.intentRelation)) {
        diagnostics.push(`${field}.intentRelation must be one of ${INTENT_RELATIONS.join(', ')}`);
        continue;
      }
      criterionJudgments.push({ criterion: criterion.reference, criterionId: criterion.id, grade: raw.grade, evidence: raw.evidence,
        rationale: raw.rationale, requirementAssociations: associations, evidenceTaskIds, intentRelation: raw.intentRelation });
      criterionJudgmentIndexes.push(index);
      continue;
    }
    criterionJudgments.push({ criterion: criterion.reference, criterionId: criterion.id, grade: raw.grade, evidence: raw.evidence,
      rationale: raw.rationale, requirementAssociations: associations, evidenceTaskIds });
    criterionJudgmentIndexes.push(index);
  }

  const carriersByCriterionId = new Map<string, number[]>();
  for (const [index, judgment] of criterionJudgments.entries()) {
    const normalizedCriterionId = judgment.criterionId.toLowerCase();
    const carriers = carriersByCriterionId.get(normalizedCriterionId) ?? [];
    carriers.push(index);
    carriersByCriterionId.set(normalizedCriterionId, carriers);
  }
  const duplicateCriterionIndexes = new Set<number>();
  for (const carriers of carriersByCriterionId.values()) {
    if (carriers.length < 2) continue;
    const duplicateCriterionId = criterionJudgments[carriers[0]].criterionId;
    for (const carrier of carriers) {
      duplicateCriterionIndexes.add(carrier);
      diagnostics.push(`criterionJudgments[${criterionJudgmentIndexes[carrier]}].criterion duplicates normalized criterion ${duplicateCriterionId}`);
    }
  }

  const noOwnerObservations: PrdAuditNoOwnerObservation[] = [];
  for (const [index, raw] of input.noOwnerObservations.entries()) {
    const field = `noOwnerObservations[${index}]`;
    if (!record(raw) || !validBase(raw, field, diagnostics)) continue;
    const permitted = ['grade', 'evidence', 'rationale', 'intentRelation'];
    const unexpected = Object.keys(raw).find((key) => !permitted.includes(key));
    if (!exactKeys(raw, permitted) || raw.grade !== 'OVER_SCOPE') {
      diagnostics.push(`${field}${unexpected === undefined ? '' : `.${unexpected}`} permits only OVER_SCOPE with evidence, rationale, and intentRelation`);
      continue;
    }
    if (!isIntentRelation(raw.intentRelation)) {
      diagnostics.push(`${field}.intentRelation must be one of ${INTENT_RELATIONS.join(', ')}`);
      continue;
    }
    noOwnerObservations.push({ presentationOrdinal: `NC-${noOwnerObservations.length + 1}`, grade: 'OVER_SCOPE', evidence: raw.evidence,
      rationale: raw.rationale, intentRelation: raw.intentRelation });
  }

  const judgment = {
    version: PRD_AUDIT_JUDGMENT_CONTRACT_VERSION,
    criterionJudgments: criterionJudgments.filter((_, index) => !duplicateCriterionIndexes.has(index)),
    noOwnerObservations,
  };
  if (diagnostics.length === 0) return { ok: true, judgment };
  return judgment.criterionJudgments.length > 0 || judgment.noOwnerObservations.length > 0
    ? { ok: false, judgment, diagnostics }
    : { ok: false, diagnostics };
}
