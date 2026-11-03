/**
 * Codex sends `--output-schema` to the OpenAI structured-output API in strict
 * mode, which requires every object to list all of its properties in
 * `required`. Engine contracts share one schema with Claude's native grammar
 * and leave some fields optional, so the Codex adapter sends a strict copy in
 * which each optional property is required but nullable, and removes those
 * nulls from the result before any parser sees it. Strict mode also demands a
 * `type` on every subschema and rejects `oneOf`, so the copy types each bare
 * `const`/`enum` and rewrites `oneOf` as `anyOf`. The root must be a plain
 * object, so a root union of object branches is sent as one object holding
 * every branch's properties. That object cannot stop a result filling another
 * branch's properties, so the result keeps only what its own branch declares;
 * the engine's closed parser still enforces which combinations are valid.
 */

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function propertiesOf(schema: JsonObject): JsonObject | undefined {
  return isObject(schema.properties) ? schema.properties : undefined;
}

function requiredOf(schema: JsonObject): readonly string[] {
  return Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === 'string') : [];
}

function jsonTypeOf(value: unknown): string | undefined {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return typeof value;
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number';
  return undefined;
}

/** Strict mode demands a `type` on every schema; infer it from a `const` or single-typed `enum`. */
function inferredType(schema: JsonObject): string | undefined {
  if (schema.type !== undefined) return undefined;
  const values = 'const' in schema ? [schema.const] : Array.isArray(schema.enum) ? schema.enum : [];
  const types = new Set(values.map(jsonTypeOf));
  return types.size === 1 ? [...types][0] : undefined;
}

/** The branches of a root union, when every one of them is an object with properties. */
function rootObjectBranches(schema: unknown): readonly JsonObject[] | undefined {
  if (!isObject(schema) || schema.type !== undefined) return undefined;
  const branches = schema.oneOf ?? schema.anyOf;
  if (!Array.isArray(branches) || branches.length === 0) return undefined;
  const objectBranches = branches.filter(isObject);
  return objectBranches.length === branches.length && objectBranches.every((branch) => propertiesOf(branch) !== undefined)
    ? objectBranches
    : undefined;
}

/**
 * Merges a root union of object branches into the one object strict mode accepts.
 * A property stays required only when every branch requires it, and branch-level
 * rules such as `anyOf: [{ required: [...] }]` are dropped because strict mode
 * cannot express them.
 */
function withObjectRoot(schema: unknown): unknown {
  const objectBranches = rootObjectBranches(schema);
  if (objectBranches === undefined) return schema;
  const variants = new Map<string, Map<string, unknown>>();
  for (const branch of objectBranches) {
    for (const [key, property] of Object.entries(propertiesOf(branch)!)) {
      const known = variants.get(key) ?? new Map<string, unknown>();
      known.set(JSON.stringify(property), property);
      variants.set(key, known);
    }
  }
  const properties: JsonObject = {};
  for (const [key, known] of variants) {
    const distinct = [...known.values()];
    properties[key] = distinct.length === 1 ? distinct[0] : { anyOf: distinct };
  }
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties).filter((key) => objectBranches.every((branch) => requiredOf(branch).includes(key))),
    properties,
  };
}

/** Returns a strict-mode copy of `schema`; the input is never mutated. */
export function toCodexStrictSchema(schema: unknown): unknown {
  return strictCopy(withObjectRoot(schema));
}

function strictCopy(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictCopy);
  if (!isObject(schema)) return schema;
  const strict: JsonObject = {};
  const type = inferredType(schema);
  if (type !== undefined) strict.type = type;
  for (const [key, value] of Object.entries(schema)) {
    // Strict mode rejects `oneOf`; engine contracts use it only for disjoint branches, so `anyOf` is equivalent.
    strict[key === 'oneOf' ? 'anyOf' : key] = key === 'enum' || key === 'const' ? value : strictCopy(value);
  }
  const properties = propertiesOf(schema);
  if (properties === undefined) return strict;
  const required = new Set(requiredOf(schema));
  const strictProperties = strict.properties as JsonObject;
  for (const key of Object.keys(properties)) {
    if (!required.has(key)) strictProperties[key] = { anyOf: [strictProperties[key], { type: 'null' }] };
  }
  strict.required = Object.keys(properties);
  return strict;
}

/** The one branch whose `const` properties all match `value`, if exactly one branch does. */
function discriminatedBranch(branches: readonly JsonObject[], value: JsonObject): JsonObject | undefined {
  const matching = branches.filter((branch) => {
    const consts = Object.entries(propertiesOf(branch)!).filter(([, property]) => isObject(property) && 'const' in property);
    return consts.length > 0 && consts.every(([key, property]) => value[key] === (property as JsonObject).const);
  });
  return matching.length === 1 ? matching[0] : undefined;
}

/** Drops what only the merged root admitted: properties of other branches, not unknown ones. */
function withoutOtherBranchProperties(schema: unknown, value: unknown): unknown {
  const branches = rootObjectBranches(schema);
  if (branches === undefined || !isObject(value)) return value;
  const branch = discriminatedBranch(branches, value);
  if (branch === undefined) return value;
  const declared = propertiesOf(branch)!;
  const isOtherBranchProperty = (key: string) => !(key in declared) && branches.some((other) => key in propertiesOf(other)!);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !isOtherBranchProperty(key)));
}

/** Reverses what `toCodexStrictSchema` admitted: other branches' properties and optional nulls. */
export function fromCodexStrictResult(schema: unknown, value: unknown): unknown {
  return withoutAdmittedNulls(withObjectRoot(schema), withoutOtherBranchProperties(schema, value));
}

function withoutAdmittedNulls(schema: unknown, value: unknown): unknown {
  if (!isObject(schema)) return value;
  if (Array.isArray(value)) {
    return isObject(schema.items) ? value.map((item) => withoutAdmittedNulls(schema.items, item)) : value;
  }
  const properties = propertiesOf(schema);
  if (!isObject(value) || properties === undefined) return value;
  const required = new Set(requiredOf(schema));
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === null && !required.has(key) && key in properties) continue;
    result[key] = key in properties ? withoutAdmittedNulls(properties[key], child) : child;
  }
  return result;
}
