import type { BuildReviewFindingIdentity } from './build-review-finding-identity.js';

/** JSON Schema stays structural so the native provider seam owns its dialect. */
export type RubricOutputJsonSchema = Readonly<Record<string, unknown>>;

export interface RubricProjectionContract<Source = unknown, Projection = unknown> {
  readonly version: string;
  readonly build: (source: Source) => Projection;
}

export interface RubricOutputContract<Output = unknown> {
  readonly version: string;
  readonly jsonSchema: RubricOutputJsonSchema;
  readonly parse: (value: unknown) => Output | undefined;
}

export interface RubricIdentityContract<Identity = BuildReviewFindingIdentity> {
  readonly canonicalize: (value: unknown) => Identity | undefined;
}

/** The complete engine-owned projection, output, and finding-identity contract. */
export interface RubricContractDescriptor<Source = unknown, Projection = unknown, Output = unknown, Identity = BuildReviewFindingIdentity> {
  readonly projection: RubricProjectionContract<Source, Projection>;
  readonly output: RubricOutputContract<Output>;
  readonly identity: RubricIdentityContract<Identity>;
}

export interface BuildReviewContractCatalogMember<Source = unknown, Projection = unknown, Output = unknown, Identity = BuildReviewFindingIdentity> {
  readonly id: string;
  readonly contract: RubricContractDescriptor<Source, Projection, Output, Identity>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function missingPart(member: { readonly id: string; readonly contract: unknown }): string | undefined {
  const contract = record(member.contract);
  if (!contract) return 'contract';

  const projection = record(contract.projection);
  if (!projection) return 'contract.projection';
  if (typeof projection.version !== 'string' || projection.version.length === 0) return 'projection.version';
  if (typeof projection.build !== 'function') return 'projection.build';

  const output = record(contract.output);
  if (!output) return 'contract.output';
  if (typeof output.version !== 'string' || output.version.length === 0) return 'output.version';
  if (!record(output.jsonSchema)) return 'output.jsonSchema';
  if (typeof output.parse !== 'function') return 'output.parse';

  const identity = record(contract.identity);
  if (!identity) return 'contract.identity';
  return typeof identity.canonicalize === 'function' ? undefined : 'identity.canonicalize';
}

/**
 * Validate every member before any rubric dispatch can observe the catalog.
 * This is an authoring-time contract error, not a provider result.
 */
export function resolveBuildReviewContractCatalog<
  Member extends { readonly id: string; readonly contract: unknown },
>(members: readonly Member[]): readonly Member[] {
  const ids = new Set<string>();
  for (const member of members) {
    if (ids.has(member.id)) throw new Error(`Duplicate build-review rubric id: ${member.id}`);
    ids.add(member.id);
  }
  for (const member of members) {
    const missing = missingPart(member);
    if (missing) throw new Error(`Build-review rubric ${member.id} is missing ${missing}`);
  }
  return Object.freeze([...members]);
}

function enumShape(schema: Record<string, unknown>): string | undefined {
  return Array.isArray(schema.enum) && schema.enum.every((member) => typeof member === 'string' || typeof member === 'number')
    ? `enum(${schema.enum.map((member) => `\`${String(member)}\``).join(' | ')})`
    : undefined;
}

function schemaShape(schema: unknown, topLevel = false): string {
  const source = record(schema);
  if (!source) return 'value';
  const enumeration = enumShape(source);
  if (enumeration !== undefined) return enumeration;
  const alternatives = Array.isArray(source.oneOf) ? source.oneOf : Array.isArray(source.anyOf) ? source.anyOf : undefined;
  if (alternatives) return alternatives.map((alternative) => schemaShape(alternative, topLevel)).join(' Or ');
  if (source.type === 'array') return `array of ${schemaShape(source.items)}`;
  if (source.type === 'string') return 'string';
  if (source.type === 'integer') return 'integer';
  if (source.type !== 'object') return 'value';

  const properties = record(source.properties) ?? {};
  const fields = Object.entries(properties).map(([key, property]) =>
    `${topLevel ? `\`${key}\`` : key}: ${schemaShape(property)}`,
  );
  const required = Array.isArray(source.required) && source.required.every((key) => typeof key === 'string')
    ? source.required.join(', ')
    : '';
  const constraints = [
    ...(required ? [`required: ${required}`] : []),
    ...(source.additionalProperties === false ? ['additionalProperties: false'] : []),
  ];
  return `{ ${fields.join(', ')} }${constraints.length ? ` (${constraints.join('; ')})` : ''}`;
}

/** Render the complete provider-visible result shape from the descriptor's own schema. */
export function renderRubricContractShape(descriptor: Pick<RubricContractDescriptor, 'output'>): string {
  return schemaShape(descriptor.output.jsonSchema, true);
}
