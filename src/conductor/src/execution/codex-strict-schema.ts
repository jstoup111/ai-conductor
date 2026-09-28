/**
 * Codex sends `--output-schema` to the OpenAI structured-output API in strict
 * mode, which requires every object to list all of its properties in
 * `required`. Engine contracts share one schema with Claude's native grammar
 * and leave some fields optional, so the Codex adapter sends a strict copy in
 * which each optional property is required but nullable, and removes those
 * nulls from the result before any parser sees it.
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

/** Returns a strict-mode copy of `schema`; the input is never mutated. */
export function toCodexStrictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toCodexStrictSchema);
  if (!isObject(schema)) return schema;
  const strict: JsonObject = {};
  for (const [key, value] of Object.entries(schema)) {
    strict[key] = key === 'enum' || key === 'const' ? value : toCodexStrictSchema(value);
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

/** Removes the nulls `toCodexStrictSchema` admitted for originally optional properties. */
export function fromCodexStrictResult(schema: unknown, value: unknown): unknown {
  if (!isObject(schema)) return value;
  if (Array.isArray(value)) {
    return isObject(schema.items) ? value.map((item) => fromCodexStrictResult(schema.items, item)) : value;
  }
  const properties = propertiesOf(schema);
  if (!isObject(value) || properties === undefined) return value;
  const required = new Set(requiredOf(schema));
  const result: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === null && !required.has(key) && key in properties) continue;
    result[key] = key in properties ? fromCodexStrictResult(properties[key], child) : child;
  }
  return result;
}
