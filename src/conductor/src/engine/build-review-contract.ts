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

function recordTokens(value: unknown, tokens: Set<string>, seen: WeakSet<object>): void {
  if (Array.isArray(value)) {
    for (const entry of value) recordTokens(entry, tokens, seen);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  const source = value as Record<string, unknown>;
  if (Array.isArray(source.enum)) {
    for (const member of source.enum) {
      if (typeof member === 'string' || typeof member === 'number') tokens.add(String(member));
    }
  }
  for (const child of Object.values(source)) recordTokens(child, tokens, seen);
}

/** Render the provider-visible field and enum vocabulary from the descriptor's own schema. */
export function renderRubricContractShape(descriptor: Pick<RubricContractDescriptor, 'output'>): string {
  const properties = record(descriptor.output.jsonSchema.properties);
  const fields = properties ? Object.keys(properties) : [];
  const tokens = new Set(fields);
  recordTokens(descriptor.output.jsonSchema, tokens, new WeakSet());
  return [...tokens].sort().map((token) => `\`${token}\``).join(', ');
}
