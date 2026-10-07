import {
  REMEDIATION_EXISTING_TASK_DISPOSITION,
  REMEDIATION_HALT_CATEGORIES,
  REMEDIATION_PUBLICATION_DISPOSITION,
  REMEDIATION_TARGET_STEPS,
} from './artifacts.js';

/** The versioned, engine-owned output contract for remediation gap plans. */
export const REMEDIATION_PLAN_CONTRACT_VERSION = 'v1' as const;

const REMEDIATION_DISPOSITIONS = [
  ...REMEDIATION_TARGET_STEPS,
  REMEDIATION_PUBLICATION_DISPOSITION,
  REMEDIATION_EXISTING_TASK_DISPOSITION,
  'halt',
] as const;

const NON_BLANK_STRING = { type: 'string', minLength: 1 } as const;

const remediationReferenceSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'id'],
  properties: {
    kind: {
      type: 'string',
      enum: ['prd-criterion', 'as-built-finding', 'refusal', 'stall', 'test'],
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
