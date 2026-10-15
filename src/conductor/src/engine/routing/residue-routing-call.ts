/**
 * The routing judgement is deliberately independent of every gate-verdict
 * contract. It places already-admitted residue; it never admits new work.
 */

export const RESIDUE_ROUTING_CALL_CONTRACT_VERSION = 'v1' as const;
export const RESIDUE_ROUTING_MAX_ATTEMPTS = 2;
export const RESIDUE_ROUTING_CALL_MEMBER = 'residue-routing-call';

export const RESIDUE_ROUTING_CALL_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['version', 'items'],
  properties: {
    version: { const: RESIDUE_ROUTING_CALL_CONTRACT_VERSION },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['itemId', 'child', 'candidates', 'rationale'],
        properties: {
          itemId: { type: 'string', minLength: 1 },
          child: { type: 'integer', minimum: 1 },
          candidates: { type: 'array', minItems: 1, items: { type: 'integer', minimum: 1 } },
          rationale: { type: 'string', minLength: 1 },
        },
      },
    },
  },
} as const);

export interface ResidueRoutingItem {
  readonly itemId: string;
  readonly [key: string]: unknown;
}

export interface ResidueRoutingAnswer {
  readonly itemId: string;
  readonly child: number;
  readonly candidates: readonly number[];
  readonly rationale: string;
}

export type ParsedResidueRoutingItem =
  | ({ readonly kind: 'valid' } & ResidueRoutingAnswer)
  | { readonly kind: 'invalid-position'; readonly itemId: string; readonly detail: string }
  | { readonly kind: 'malformed'; readonly itemId: string; readonly detail: string };

export type ResidueRoutingJudge = (prompt: string) => Promise<{ success: boolean; output?: string }>;

export type ResidueRoutingCallResult =
  | { readonly kind: 'routed'; readonly answers: readonly (Extract<ParsedResidueRoutingItem, { kind: 'valid' }>)[] }
  | { readonly kind: 'halt'; readonly itemId: string; readonly detail: string };

function malformed(items: readonly ResidueRoutingItem[], detail: string): ParsedResidueRoutingItem[] {
  return items.map((item) => ({ kind: 'malformed', itemId: item.itemId, detail }));
}

/** Retain why residue is placed at a judgment or deterministic fallback. */
export function resolveResidueOwner(answer: ResidueRoutingAnswer): { readonly owner: number; readonly reason: 'residue-judged' | 'residue-default'; readonly rationale: string } {
  return answer.candidates.length === 1 && answer.candidates[0] === answer.child
    ? { owner: answer.child, reason: 'residue-judged', rationale: answer.rationale }
    : { owner: Math.min(...answer.candidates), reason: 'residue-default', rationale: answer.rationale };
}

function isPositivePosition(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function parseObject(output: string): Record<string, unknown> | undefined {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end < start) return undefined;
  try {
    const parsed: unknown = JSON.parse(output.slice(start, end + 1));
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

/** Validate the closed response shape, then classify position violations per item. */
export function parseResidueRoutingAnswer(
  output: string,
  items: readonly ResidueRoutingItem[],
  declaredPositions: readonly number[],
): ParsedResidueRoutingItem[] {
  const record = parseObject(output);
  if (!record) return malformed(items, 'routing judgement output is not a JSON object');
  if (Object.keys(record).some((key) => key !== 'version' && key !== 'items') ||
      record.version !== RESIDUE_ROUTING_CALL_CONTRACT_VERSION || !Array.isArray(record.items)) {
    return malformed(items, 'routing judgement does not match the residue routing contract');
  }

  const expectedIds = new Set(items.map((item) => item.itemId));
  const rows = record.items;
  if (rows.length !== items.length) return malformed(items, 'routing judgement must answer every residue item exactly once');
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return malformed(items, 'routing judgement item is not an object');
    const item = row as Record<string, unknown>;
    const allowed = new Set(['itemId', 'child', 'candidates', 'rationale']);
    if (Object.keys(item).some((key) => !allowed.has(key)) || typeof item.itemId !== 'string' ||
        !expectedIds.has(item.itemId) || byId.has(item.itemId) || !isPositivePosition(item.child) ||
        !Array.isArray(item.candidates) || item.candidates.length === 0 || !item.candidates.every(isPositivePosition) ||
        new Set(item.candidates).size !== item.candidates.length || typeof item.rationale !== 'string' || item.rationale.trim() === '') {
      return malformed(items, 'routing judgement item does not match the residue routing contract');
    }
    byId.set(item.itemId, item);
  }

  const positions = new Set(declaredPositions);
  return items.map((item) => {
    const row = byId.get(item.itemId)!;
    const child = row.child as number;
    const candidates = row.candidates as number[];
    const undeclared = [child, ...candidates].filter((position) => !positions.has(position));
    if (undeclared.length > 0) {
      return { kind: 'invalid-position', itemId: item.itemId, detail: `undeclared slice position ${undeclared[0]}` };
    }
    return { kind: 'valid', itemId: item.itemId, child, candidates, rationale: row.rationale as string };
  });
}

export function renderResidueRoutingPrompt(
  items: readonly ResidueRoutingItem[],
  declaredPositions: readonly number[],
): string {
  return [
    'Place every already-admitted residue item in a declared slice position. Do not admit, reject, or change work.',
    'Return exactly one JSON object matching this engine-owned contract.',
    JSON.stringify({ contract: RESIDUE_ROUTING_CALL_SCHEMA, declaredPositions, items }),
  ].join('\n\n');
}

/** One batched routing judgement per round, with exactly one re-ask on failure. */
export async function runResidueRoutingCall({
  items,
  declaredPositions,
  judge,
}: {
  readonly items: readonly ResidueRoutingItem[];
  readonly declaredPositions: readonly number[];
  readonly judge?: ResidueRoutingJudge;
}): Promise<ResidueRoutingCallResult> {
  if (items.length === 0) return { kind: 'routed', answers: [] };
  if (!judge) return { kind: 'halt', itemId: items[0]!.itemId, detail: 'no residue routing judge available' };
  const prompt = renderResidueRoutingPrompt(items, declaredPositions);
  let last: ParsedResidueRoutingItem[] | undefined;
  for (let attempt = 0; attempt < RESIDUE_ROUTING_MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await judge(prompt);
      last = result.success && typeof result.output === 'string'
        ? parseResidueRoutingAnswer(result.output, items, declaredPositions)
        : malformed(items, `residue routing provider failed: ${result.output ?? 'no output'}`);
    } catch (error) {
      last = malformed(items, `residue routing dispatch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (last.every((answer) => answer.kind === 'valid')) {
      return { kind: 'routed', answers: last as Extract<ParsedResidueRoutingItem, { kind: 'valid' }>[] };
    }
  }
  const invalid = last!.find((answer) => answer.kind !== 'valid')!;
  return { kind: 'halt', itemId: invalid.itemId, detail: invalid.detail };
}
