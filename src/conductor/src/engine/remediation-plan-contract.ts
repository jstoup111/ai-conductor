import {
  REMEDIATION_EXISTING_TASK_DISPOSITION,
  REMEDIATION_HALT_CATEGORIES,
  REMEDIATION_PUBLICATION_DISPOSITION,
  REMEDIATION_TARGET_STEPS,
  remediationDispositionStep,
  type RemediationDisposition,
  type RemediationDispositionRejection,
  type RemediationHaltCategory,
} from './artifacts.js';
import { resolvePlanTaskReference } from './plan-task-parse.js';
import type { RemediationProjection, RemediationRequiredReference } from './remediation-projection.js';

/** The versioned, engine-owned output contract for remediation gap plans. */
export const REMEDIATION_PLAN_CONTRACT_VERSION = 'v1' as const;

const REMEDIATION_DISPOSITIONS = [
  ...REMEDIATION_TARGET_STEPS,
  REMEDIATION_PUBLICATION_DISPOSITION,
  REMEDIATION_EXISTING_TASK_DISPOSITION,
  'halt',
] as const;

const NON_BLANK_STRING = { type: 'string', minLength: 1 } as const;

const REMEDIATION_REFERENCE_KINDS = ['prd-criterion', 'as-built-finding', 'refusal', 'stall', 'test'] as const;

const remediationReferenceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'id'],
  properties: {
    kind: {
      type: 'string',
      enum: REMEDIATION_REFERENCE_KINDS,
    },
    id: NON_BLANK_STRING,
  },
} as const;

const remediationTaskSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'title'],
  properties: { id: NON_BLANK_STRING, title: NON_BLANK_STRING },
} as const;

/** Engine-owned schema passed unchanged to provider-native schema adapters. */
export const REMEDIATION_PLAN_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['version', 'dispositions'],
  properties: {
    version: { const: REMEDIATION_PLAN_CONTRACT_VERSION },
    dispositions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['reference', 'disposition', 'category', 'rationale', 'tasks', 'boundTaskIds'],
        properties: {
          reference: remediationReferenceSchema,
          disposition: { type: 'string', enum: REMEDIATION_DISPOSITIONS },
          category: {
            anyOf: [
              { type: 'string', enum: REMEDIATION_HALT_CATEGORIES },
              { type: 'null' },
            ],
          },
          rationale: NON_BLANK_STRING,
          tasks: { type: 'array', items: remediationTaskSchema },
          boundTaskIds: { type: 'array', items: NON_BLANK_STRING },
        },
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

export interface AcceptedRemediationPlanDisposition {
  readonly reference: { readonly kind: 'stall' | 'test'; readonly id: string } | RemediationRequiredReference;
  /** Present only when this answer accounts for an engine-projected typed reference. */
  readonly requiredReference?: RemediationRequiredReference;
  readonly disposition: RemediationDisposition;
  readonly targetStep: string;
  readonly category: RemediationHaltCategory | null;
  readonly rationale: string;
  readonly tasks: readonly { readonly id: string; readonly title: string }[];
  readonly boundTaskIds: readonly string[];
}

export type ValidateRemediationPlanResult =
  | { readonly kind: 'accepted'; readonly dispositions: readonly AcceptedRemediationPlanDisposition[] }
  | {
      readonly kind: 'rejected';
      readonly diagnostics: readonly string[];
      /** Field-specific rejections retained for the event-spine consumer. */
      readonly rejected?: readonly RemediationDispositionRejection[];
    };

function nonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function referenceKey(kind: string, id: string): string {
  return `${kind}:${kind === 'prd-criterion' ? id.toLowerCase() : id}`;
}

function typedReference(
  kind: string,
  id: string,
  projection: RemediationProjection,
): RemediationRequiredReference | undefined {
  const key = referenceKey(kind, id);
  return projection.requiredReferences.find((reference) => referenceKey(reference.kind, reference.id) === key);
}

function isDisposition(value: unknown): value is RemediationDisposition {
  return typeof value === 'string' && (REMEDIATION_DISPOSITIONS as readonly string[]).includes(value);
}

function isHaltCategory(value: unknown): value is RemediationHaltCategory {
  return typeof value === 'string' && (REMEDIATION_HALT_CATEGORIES as readonly string[]).includes(value);
}

function renderRejectedVocabularyValue(value: unknown): string {
  if (value === undefined) return '<missing>';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function recordBoundTaskIdsRejection(
  rejected: RemediationDispositionRejection[],
  reference: RemediationRequiredReference,
  boundTaskIds: readonly string[],
  ownerTaskId: string,
): void {
  rejected.push({
    gapId: reference.id,
    disposition: boundTaskIds.length === 0 ? '<empty>' : boundTaskIds.join(','),
    accepted: [ownerTaskId],
    field: 'boundTaskIds',
  });
}

function untypedReferenceMatchesSource(kind: 'stall' | 'test', source: RemediationProjection['source']): boolean {
  return (kind === 'stall' && source === 'build-stall') ||
    (kind === 'test' && source === 'finish-verification');
}

function owningTaskId(reference: RemediationRequiredReference): string | undefined {
  if (reference.kind === 'prd-criterion') return reference.ownerTaskId;
  if (reference.kind === 'as-built-finding' && reference.reference.kind === 'plan-task') {
    return reference.reference.taskId;
  }
  return undefined;
}

function projectedRefusalReference(
  id: string,
  projection: RemediationProjection,
): RemediationRequiredReference | undefined {
  const refusal = projection.refusals.find((candidate) => candidate.decisionId === id);
  if (refusal === undefined) return undefined;

  return projection.requiredReferences.find((candidate) =>
    candidate.kind === 'refusal' && candidate.id === id,
  ) ?? {
    kind: 'refusal',
    id,
    sourceGate: 'refusal-rework',
    revision: refusal.revision,
    rationale: refusal.rationale,
  };
}

/**
 * Validates a provider's remediation plan against the engine-prepared projection.
 * A typed answer is linked to the exact reference object projected for this attempt;
 * untyped stall and test answers are grammar-checked without completeness accounting.
 */
export function validateRemediationPlan(raw: unknown, projection: RemediationProjection): ValidateRemediationPlanResult {
  const diagnostics: string[] = [];
  const rejected: RemediationDispositionRejection[] = [];
  if (!record(raw) || !exactKeys(raw, ['version', 'dispositions'])) {
    return { kind: 'rejected', diagnostics: ['root requires exactly version and dispositions'] };
  }
  if (raw.version !== REMEDIATION_PLAN_CONTRACT_VERSION) {
    return { kind: 'rejected', diagnostics: [`version must be ${REMEDIATION_PLAN_CONTRACT_VERSION}`] };
  }
  if (!Array.isArray(raw.dispositions)) {
    return { kind: 'rejected', diagnostics: ['dispositions must be an array'] };
  }

  const dispositions: AcceptedRemediationPlanDisposition[] = [];
  const answeredTypedReferences = new Set<string>();
  const answeredRefusalReferences = new Set<string>();
  for (const [index, candidate] of raw.dispositions.entries()) {
    const field = `dispositions[${index}]`;
    if (!record(candidate) || !exactKeys(candidate, ['reference', 'disposition', 'category', 'rationale', 'tasks', 'boundTaskIds'])) {
      diagnostics.push(`${field} requires exactly reference, disposition, category, rationale, tasks, and boundTaskIds`);
      continue;
    }
    if (!record(candidate.reference)) {
      diagnostics.push(`${field}.reference must be an object`);
      continue;
    }
    if (!nonEmptyText(candidate.reference.kind)) {
      diagnostics.push(`${field}.reference.kind must be non-empty`);
      continue;
    }
    if (!nonEmptyText(candidate.reference.id)) {
      diagnostics.push(`${field}.reference.id must be non-empty`);
      continue;
    }
    if (!exactKeys(candidate.reference, ['kind', 'id'])) {
      diagnostics.push(`${field}.reference requires exactly kind and id`);
      continue;
    }
    if (!(REMEDIATION_REFERENCE_KINDS as readonly string[]).includes(candidate.reference.kind)) {
      diagnostics.push(`${field}.reference.kind must be one of ${REMEDIATION_REFERENCE_KINDS.join(', ')}`);
      continue;
    }
    if (!isDisposition(candidate.disposition)) {
      diagnostics.push(`${field}.disposition must be one of ${REMEDIATION_DISPOSITIONS.join(', ')}`);
      rejected.push({
        gapId: candidate.reference.id as string,
        disposition: renderRejectedVocabularyValue(candidate.disposition),
        accepted: REMEDIATION_DISPOSITIONS,
        field: 'disposition',
      });
      continue;
    }
    if (candidate.category !== null && !isHaltCategory(candidate.category)) {
      diagnostics.push(`${field}.category must be null or one of ${REMEDIATION_HALT_CATEGORIES.join(', ')}`);
      rejected.push({
        gapId: candidate.reference.id as string,
        disposition: renderRejectedVocabularyValue(candidate.category),
        accepted: REMEDIATION_HALT_CATEGORIES,
        field: 'category',
      });
      continue;
    }
    if (candidate.disposition === 'halt' && candidate.category === null) {
      diagnostics.push(`${field}.category is required for halt`);
      continue;
    }
    if (!nonEmptyText(candidate.rationale)) {
      diagnostics.push(`${field}.rationale must be non-empty`);
      continue;
    }
    if (!Array.isArray(candidate.tasks) || !candidate.tasks.every((task) =>
      record(task) && exactKeys(task, ['id', 'title']) && nonEmptyText(task.id) && nonEmptyText(task.title))) {
      diagnostics.push(`${field}.tasks must contain only non-empty id and title pairs`);
      continue;
    }
    if (!Array.isArray(candidate.boundTaskIds) || !candidate.boundTaskIds.every(nonEmptyText)) {
      diagnostics.push(`${field}.boundTaskIds must be an array of non-empty task ids`);
      continue;
    }
    if (candidate.disposition === 'build' && candidate.tasks.length === 0 && projection.source !== 'build-stall') {
      diagnostics.push(`${field}.tasks requires at least one task for build`);
      continue;
    }

    const { kind, id } = candidate.reference;
    if (kind === 'stall' || kind === 'test') {
      const grammar = kind === 'stall' ? /^stall:[A-Za-z0-9][A-Za-z0-9._-]*$/ : /^test:[A-Za-z0-9][A-Za-z0-9._-]*$/;
      if (!grammar.test(id)) {
        diagnostics.push(`${field}.reference.id must match ${kind}:${kind === 'stall' ? '<slug>' : '<stem>'}`);
        continue;
      }
      if (!untypedReferenceMatchesSource(kind, projection.source)) {
        diagnostics.push(`${field}.reference is only valid for ${kind === 'stall' ? 'build-stall' : 'finish-verification'} source`);
        continue;
      }
    }
    if (kind === 'refusal') {
      const requiredReference = projectedRefusalReference(id, projection);
      if (requiredReference === undefined) {
        diagnostics.push(`${field}.reference does not resolve projected refusal ${id}`);
        continue;
      }
      if (answeredRefusalReferences.has(id)) {
        diagnostics.push(`${field}.reference duplicates projected refusal ${id}`);
        continue;
      }
      answeredRefusalReferences.add(id);
      dispositions.push({
        reference: requiredReference,
        requiredReference,
        disposition: candidate.disposition,
        targetStep: remediationDispositionStep(candidate.disposition),
        category: candidate.category,
        rationale: candidate.rationale,
        tasks: candidate.tasks.map((task) => ({ id: task.id as string, title: task.title as string })),
        boundTaskIds: [...candidate.boundTaskIds] as string[],
      });
      continue;
    }
    const requiredReference = typedReference(kind, id, projection);
    if (requiredReference !== undefined) {
      const key = referenceKey(requiredReference.kind, requiredReference.id);
      if (answeredTypedReferences.has(key)) {
        diagnostics.push(`${field}.reference duplicates required reference ${requiredReference.kind}:${requiredReference.id}`);
        continue;
      }
      const ownerTaskId = owningTaskId(requiredReference);
      let boundTaskIds = [...candidate.boundTaskIds] as string[];
      if (candidate.disposition === REMEDIATION_EXISTING_TASK_DISPOSITION && ownerTaskId !== undefined) {
        if (boundTaskIds.length === 0) {
          diagnostics.push(`${field}.boundTaskIds requires at least one task id for existing-task`);
          recordBoundTaskIdsRejection(rejected, requiredReference, boundTaskIds, ownerTaskId);
          continue;
        }
        const resolution = resolvePlanTaskReference(
          boundTaskIds.join(','),
          new Set(projection.tasks.map((task) => task.id)),
        );
        if (resolution.kind === 'malformed') {
          diagnostics.push(`${field}.boundTaskIds must use the shared active-plan task-id grammar`);
          recordBoundTaskIdsRejection(rejected, requiredReference, boundTaskIds, ownerTaskId);
          continue;
        }
        if (resolution.kind === 'unresolvable') {
          diagnostics.push(`${field}.boundTaskIds does not resolve active task ${resolution.ids.join(', ')}`);
          recordBoundTaskIdsRejection(rejected, requiredReference, resolution.ids, ownerTaskId);
          continue;
        }
        const nonOwnerTaskId = resolution.ids.find((taskId) => taskId !== ownerTaskId);
        if (nonOwnerTaskId !== undefined) {
          diagnostics.push(`${field}.boundTaskIds must not bind non-owner task ${nonOwnerTaskId}; owner is ${ownerTaskId}`);
          recordBoundTaskIdsRejection(rejected, requiredReference, resolution.ids, ownerTaskId);
          continue;
        }
        if (!resolution.ids.includes(ownerTaskId)) {
          diagnostics.push(`${field}.boundTaskIds must bind owner task ${ownerTaskId}`);
          recordBoundTaskIdsRejection(rejected, requiredReference, resolution.ids, ownerTaskId);
          continue;
        }
        boundTaskIds = resolution.ids;
      }
      answeredTypedReferences.add(key);
      dispositions.push({
        reference: requiredReference,
        requiredReference,
        disposition: candidate.disposition,
        targetStep: remediationDispositionStep(candidate.disposition),
        category: candidate.category,
        rationale: candidate.rationale,
        tasks: candidate.tasks.map((task) => ({ id: task.id as string, title: task.title as string })),
        boundTaskIds,
      });
      continue;
    }
    if (kind === 'stall' || kind === 'test') {
      dispositions.push({
        reference: { kind: kind as 'stall' | 'test', id },
        disposition: candidate.disposition,
        targetStep: remediationDispositionStep(candidate.disposition),
        category: candidate.category,
        rationale: candidate.rationale,
        tasks: candidate.tasks.map((task) => ({ id: task.id as string, title: task.title as string })),
        boundTaskIds: [...candidate.boundTaskIds] as string[],
      });
      continue;
    }
    diagnostics.push(`${field}.reference does not resolve required reference ${kind}:${id}`);
  }

  for (const reference of projection.requiredReferences) {
    if (reference.kind === 'refusal') continue;
    const key = referenceKey(reference.kind, reference.id);
    if (!answeredTypedReferences.has(key)) {
      diagnostics.push(`dispositions missing required reference ${reference.kind}:${reference.id}`);
    }
  }
  return diagnostics.length === 0
    ? { kind: 'accepted', dispositions }
    : { kind: 'rejected', diagnostics, ...(rejected.length === 0 ? {} : { rejected }) };
}

/** Render the provider-visible result shape by walking its own JSON Schema. */
export function renderRemediationPlanShape(schema: unknown = REMEDIATION_PLAN_SCHEMA): string {
  if (!record(schema)) return 'unknown';
  if (Array.isArray(schema.enum)) return `one of ${schema.enum.map((value) => JSON.stringify(value)).join(', ')}`;
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (Array.isArray(schema.oneOf)) return schema.oneOf.map(renderRemediationPlanShape).join(' | ');
  if (Array.isArray(schema.anyOf)) return schema.anyOf.map(renderRemediationPlanShape).join(' | ');
  if (schema.type === 'array') return `array of ${renderRemediationPlanShape(schema.items)}`;
  if (schema.type === 'object' || record(schema.properties)) {
    const properties = record(schema.properties) ? schema.properties : {};
    return `{ ${Object.entries(properties)
      .map(([name, property]) => `\`${name}\`: ${renderRemediationPlanShape(property)}`)
      .join(', ')} }`;
  }
  return typeof schema.type === 'string' ? schema.type : 'unknown';
}
