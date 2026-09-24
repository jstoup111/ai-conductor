import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { adrApprovalStatus, parseAdrDecisions, readActivePlanText } from './artifacts.js';
import { parsePlanTaskBodies, resolvePlanTaskReference } from './plan-task-parse.js';

/** The versioned, engine-owned output contract for as-built review verdicts. */
export const AS_BUILT_VERDICT_CONTRACT_VERSION = 'v1' as const;

export interface AsBuiltReachability {
  readonly primitive: string;
  readonly callerChain: readonly string[];
}

export interface AsBuiltDriftNote {
  readonly note: string;
  readonly unexercised?: { readonly primitive: string; readonly signature: string };
}

export type AsBuiltGoverningReference =
  | { readonly kind: 'adr-decision'; readonly stem: string; readonly decision: number }
  | { readonly kind: 'plan-task'; readonly taskId: string };

export type AsBuiltFinding =
  | { readonly id: string; readonly class: 'REMEDIABLE'; readonly reference: AsBuiltGoverningReference; readonly summary: string }
  | { readonly id: string; readonly class: 'DESIGN'; readonly reference?: AsBuiltGoverningReference; readonly summary: string };

interface AsBuiltVerdictBase {
  readonly version: typeof AS_BUILT_VERDICT_CONTRACT_VERSION;
  readonly reachability: readonly AsBuiltReachability[];
  readonly driftNotes: readonly AsBuiltDriftNote[];
}

export type AsBuiltVerdict =
  | (AsBuiltVerdictBase & { readonly verdict: 'APPROVED' })
  | (AsBuiltVerdictBase & { readonly verdict: 'APPROVED WITH DRIFT NOTES' })
  | (AsBuiltVerdictBase & { readonly verdict: 'PLAN_GAP'; readonly outcomeDelivered: boolean; readonly affectedOutcome: string })
  | (AsBuiltVerdictBase & { readonly verdict: 'BLOCKED'; readonly findings: readonly AsBuiltFinding[]; readonly violations: string; readonly resolution: string });

export type ValidateAsBuiltVerdictResult =
  | { readonly ok: true; readonly verdict: AsBuiltVerdict }
  | { readonly ok: false; readonly field: string; readonly requirement: string };

type AsBuiltVerdictRejection = Extract<ValidateAsBuiltVerdictResult, { readonly ok: false }>;
type Parsed<Value> = { readonly ok: true; readonly value: Value } | AsBuiltVerdictRejection;

const AS_BUILT_VERDICTS = ['APPROVED', 'APPROVED WITH DRIFT NOTES', 'PLAN_GAP', 'BLOCKED'] as const;
const AS_BUILT_FINDING_CLASSES = ['REMEDIABLE', 'DESIGN'] as const;

const referenceSchema = {
  oneOf: [
    {
      type: 'object', additionalProperties: false, required: ['kind', 'stem', 'decision'],
      properties: {
        kind: { const: 'adr-decision' },
        stem: { type: 'string' },
        decision: { type: 'integer' },
      },
    },
    {
      type: 'object', additionalProperties: false, required: ['kind', 'taskId'],
      properties: {
        kind: { const: 'plan-task' },
        taskId: { type: 'string' },
      },
    },
  ],
} as const;

/** Engine-owned schema passed unchanged to provider-native schema adapters. */
export const AS_BUILT_VERDICT_SCHEMA = deepFreeze({
  type: 'object',
  additionalProperties: false,
  required: ['version', 'verdict', 'reachability', 'driftNotes'],
  properties: {
    version: { const: AS_BUILT_VERDICT_CONTRACT_VERSION },
    verdict: { type: 'string', enum: AS_BUILT_VERDICTS },
    reachability: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['primitive', 'callerChain'],
        properties: {
          primitive: { type: 'string' },
          callerChain: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    driftNotes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['note'],
        properties: {
          note: { type: 'string' },
          unexercised: {
            type: 'object', additionalProperties: false, required: ['primitive', 'signature'],
            properties: { primitive: { type: 'string' }, signature: { type: 'string' } },
          },
        },
      },
    },
    outcomeDelivered: { type: 'boolean' },
    affectedOutcome: { type: 'string' },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'class', 'summary'],
        properties: {
          id: { type: 'string' },
          class: { type: 'string', enum: AS_BUILT_FINDING_CLASSES },
          reference: referenceSchema,
          summary: { type: 'string' },
        },
      },
    },
    violations: { type: 'string' },
    resolution: { type: 'string' },
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
export function renderAsBuiltVerdictShape(schema: unknown): string {
  if (!record(schema)) return 'unknown';

  if (Array.isArray(schema.enum)) {
    return `one of ${schema.enum.map((value) => JSON.stringify(value)).join(', ')}`;
  }
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.map((alternative) => renderAsBuiltVerdictShape(alternative)).join(' | ');
  }
  if (schema.type === 'array') return `array of ${renderAsBuiltVerdictShape(schema.items)}`;
  if (schema.type === 'object' || record(schema.properties)) {
    const properties = record(schema.properties) ? schema.properties : {};
    return `{ ${Object.entries(properties)
      .map(([name, property]) => `\`${name}\`: ${renderAsBuiltVerdictShape(property)}`)
      .join(', ')} }`;
  }
  return typeof schema.type === 'string' ? schema.type : 'unknown';
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function unexpectedKey(value: Record<string, unknown>, keys: readonly string[]): string | undefined {
  return Object.keys(value).find((key) => !keys.includes(key));
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function rejected(field: string, requirement: string): AsBuiltVerdictRejection {
  return { ok: false, field, requirement };
}

function parseReachability(value: unknown): Parsed<readonly AsBuiltReachability[]> {
  if (!Array.isArray(value)) return rejected('reachability', 'an array of production-reachability entries is required');
  const entries: AsBuiltReachability[] = [];
  for (const [index, entry] of value.entries()) {
    if (!record(entry) || !exactKeys(entry, ['primitive', 'callerChain'])) return rejected(`reachability[${index}]`, 'exactly primitive and callerChain are required');
    if (!nonEmptyText(entry.primitive)) return rejected(`reachability[${index}].primitive`, 'a non-empty primitive is required');
    if (!Array.isArray(entry.callerChain) || entry.callerChain.length === 0 || !entry.callerChain.every(nonEmptyText)) {
      return rejected(`reachability[${index}].callerChain`, 'a non-empty caller chain of non-empty strings is required');
    }
    entries.push({ primitive: entry.primitive, callerChain: entry.callerChain });
  }
  return { ok: true, value: entries };
}

function parseDriftNotes(value: unknown): Parsed<readonly AsBuiltDriftNote[]> {
  if (!Array.isArray(value)) return rejected('driftNotes', 'an array of drift notes is required');
  const notes: AsBuiltDriftNote[] = [];
  for (const [index, item] of value.entries()) {
    if (!record(item) || !exactKeys(item, item.unexercised === undefined ? ['note'] : ['note', 'unexercised'])) {
      return rejected(`driftNotes[${index}]`, 'exactly note and optional unexercised are permitted');
    }
    if (!nonEmptyText(item.note)) return rejected(`driftNotes[${index}].note`, 'non-empty prose is required');
    if (item.unexercised === undefined) {
      notes.push({ note: item.note });
      continue;
    }
    if (!record(item.unexercised) || !exactKeys(item.unexercised, ['primitive', 'signature'])) {
      return rejected(`driftNotes[${index}].unexercised`, 'exactly primitive and signature are required');
    }
    if (!nonEmptyText(item.unexercised.primitive)) return rejected(`driftNotes[${index}].unexercised.primitive`, 'a non-empty primitive is required');
    if (!nonEmptyText(item.unexercised.signature)) return rejected(`driftNotes[${index}].unexercised.signature`, 'a non-empty observation signature is required');
    notes.push({ note: item.note, unexercised: { primitive: item.unexercised.primitive, signature: item.unexercised.signature } });
  }
  return { ok: true, value: notes };
}

function parseReference(value: unknown, field: string): Parsed<AsBuiltGoverningReference> {
  if (!record(value)) return rejected(field, 'an adr-decision or plan-task reference is required');
  if (value.kind === 'adr-decision') {
    if (!exactKeys(value, ['kind', 'stem', 'decision'])) return rejected(field, 'exactly kind, stem, and decision are required');
    if (!nonEmptyText(value.stem)) return rejected(`${field}.stem`, 'a non-empty ADR stem is required');
    if (typeof value.decision !== 'number' || !Number.isInteger(value.decision)) return rejected(`${field}.decision`, 'a whole-number decision id is required');
    return { ok: true, value: { kind: 'adr-decision', stem: value.stem, decision: value.decision } };
  }
  if (value.kind === 'plan-task') {
    if (!exactKeys(value, ['kind', 'taskId'])) return rejected(field, 'exactly kind and taskId are required');
    if (!nonEmptyText(value.taskId)) return rejected(`${field}.taskId`, 'a non-empty plan task id is required');
    return { ok: true, value: { kind: 'plan-task', taskId: value.taskId } };
  }
  return rejected(`${field}.kind`, 'one of adr-decision or plan-task is required');
}

function parseFindings(value: unknown): Parsed<readonly AsBuiltFinding[]> {
  if (!Array.isArray(value)) return rejected('findings', 'an array of blocking findings is required');
  const findings: AsBuiltFinding[] = [];
  for (const [index, item] of value.entries()) {
    const field = `findings[${index}]`;
    if (!record(item) || !nonEmptyText(item.id) || !nonEmptyText(item.summary)) return rejected(field, 'id and summary must be non-empty prose');
    if (item.class === 'REMEDIABLE') {
      if (item.reference === undefined) return rejected(`${field}.reference`, 'a governing reference is required for a REMEDIABLE finding');
      if (!exactKeys(item, ['id', 'class', 'reference', 'summary'])) return rejected(field, 'a REMEDIABLE finding requires exactly id, class, reference, and summary');
      const reference = parseReference(item.reference, `${field}.reference`);
      if (!reference.ok) return reference;
      findings.push({ id: item.id, class: 'REMEDIABLE', reference: reference.value, summary: item.summary });
      continue;
    }
    if (item.class === 'DESIGN') {
      if (!exactKeys(item, item.reference === undefined ? ['id', 'class', 'summary'] : ['id', 'class', 'reference', 'summary'])) {
        return rejected(field, 'a DESIGN finding permits exactly id, class, summary, and an optional reference');
      }
      if (item.reference === undefined) {
        findings.push({ id: item.id, class: 'DESIGN', summary: item.summary });
        continue;
      }
      const reference = parseReference(item.reference, `${field}.reference`);
      if (!reference.ok) return reference;
      findings.push({ id: item.id, class: 'DESIGN', reference: reference.value, summary: item.summary });
      continue;
    }
    return rejected(`${field}.class`, 'one of REMEDIABLE or DESIGN is required');
  }
  return { ok: true, value: findings };
}

/** Validate one complete terminal structured result before it becomes a verdict. */
export function validateAsBuiltVerdict(value: unknown): ValidateAsBuiltVerdictResult {
  if (!record(value)) return rejected('', 'a verdict object is required');
  if (value.version !== AS_BUILT_VERDICT_CONTRACT_VERSION) return rejected('version', `the contract version ${AS_BUILT_VERDICT_CONTRACT_VERSION} is required`);
  if (!AS_BUILT_VERDICTS.includes(value.verdict as typeof AS_BUILT_VERDICTS[number])) return rejected('verdict', `one of ${AS_BUILT_VERDICTS.join(', ')} is required`);
  const reachability = parseReachability(value.reachability);
  if (!reachability.ok) return reachability;
  const driftNotes = parseDriftNotes(value.driftNotes);
  if (!driftNotes.ok) return driftNotes;

  if (value.verdict === 'APPROVED' || value.verdict === 'APPROVED WITH DRIFT NOTES') {
    if (value.findings !== undefined) return rejected('findings', `findings are not permitted for an ${value.verdict} verdict`);
    const unexpected = unexpectedKey(value, ['version', 'verdict', 'reachability', 'driftNotes']);
    if (unexpected !== undefined) return rejected(unexpected, `only version, verdict, reachability, and driftNotes are permitted for an ${value.verdict} verdict`);
    if (!exactKeys(value, ['version', 'verdict', 'reachability', 'driftNotes'])) {
      return rejected('verdict', 'APPROVED verdicts permit no fields beyond version, verdict, reachability, and driftNotes');
    }
    return { ok: true, verdict: { version: AS_BUILT_VERDICT_CONTRACT_VERSION, verdict: value.verdict, reachability: reachability.value, driftNotes: driftNotes.value } };
  }
  if (value.verdict === 'PLAN_GAP') {
    if (typeof value.outcomeDelivered !== 'boolean') return rejected('outcomeDelivered', 'a boolean is required');
    if (!nonEmptyText(value.affectedOutcome)) return rejected('affectedOutcome', 'non-empty outcome prose is required');
    const unexpected = unexpectedKey(value, ['version', 'verdict', 'reachability', 'driftNotes', 'outcomeDelivered', 'affectedOutcome']);
    if (unexpected !== undefined) return rejected(unexpected, 'only version, verdict, reachability, driftNotes, outcomeDelivered, and affectedOutcome are permitted for a PLAN_GAP verdict');
    if (!exactKeys(value, ['version', 'verdict', 'reachability', 'driftNotes', 'outcomeDelivered', 'affectedOutcome'])) {
      return rejected('verdict', 'PLAN_GAP requires only version, verdict, reachability, driftNotes, outcomeDelivered, and affectedOutcome');
    }
    return { ok: true, verdict: { version: AS_BUILT_VERDICT_CONTRACT_VERSION, verdict: 'PLAN_GAP', reachability: reachability.value, driftNotes: driftNotes.value, outcomeDelivered: value.outcomeDelivered, affectedOutcome: value.affectedOutcome } };
  }
  if (!exactKeys(value, ['version', 'verdict', 'reachability', 'driftNotes', 'findings', 'violations', 'resolution'])) {
    return rejected('verdict', 'BLOCKED requires only version, verdict, reachability, driftNotes, findings, violations, and resolution');
  }
  const findings = parseFindings(value.findings);
  if (!findings.ok) return findings;
  if (!nonEmptyText(value.violations)) return rejected('violations', 'non-empty violation prose is required');
  if (!nonEmptyText(value.resolution)) return rejected('resolution', 'non-empty resolution prose is required');
  return { ok: true, verdict: { version: AS_BUILT_VERDICT_CONTRACT_VERSION, verdict: 'BLOCKED', reachability: reachability.value, driftNotes: driftNotes.value, findings: findings.value, violations: value.violations, resolution: value.resolution } };
}

/** Resolve every typed governing reference against the worktree's approved ADRs and active plan. */
export async function resolveAsBuiltReferences(
  verdict: AsBuiltVerdict,
  worktree: string,
): Promise<ValidateAsBuiltVerdictResult> {
  if (verdict.verdict !== 'BLOCKED') return { ok: true, verdict };

  const references = verdict.findings.flatMap((finding, index) =>
    finding.reference === undefined ? [] : [{ reference: finding.reference, field: `findings[${index}].reference` }],
  );
  if (references.length === 0) return { ok: true, verdict };

  let decisionFiles: string[] | undefined;
  let activePlanTaskIds: ReadonlySet<string> | undefined;
  let activePlanRead = false;

  for (const { reference, field } of references) {
    if (reference.kind === 'adr-decision') {
      if (decisionFiles === undefined) {
        try {
          decisionFiles = await readdir(join(worktree, '.docs', 'decisions'));
        } catch {
          return rejected(`${field}.stem`, `an ADR with status APPROVED is required; ${reference.stem} is unavailable`);
        }
      }
      const decisionFile = decisionFiles.find((file) => file.toLowerCase() === `${reference.stem}.md`.toLowerCase());
      if (decisionFile === undefined) {
        return rejected(`${field}.stem`, `an ADR with status APPROVED is required; ${reference.stem} is unavailable`);
      }

      let content: string;
      try {
        content = await readFile(join(worktree, '.docs', 'decisions', decisionFile), 'utf8');
      } catch {
        return rejected(`${field}.stem`, `an ADR with status APPROVED is required; ${reference.stem} is unavailable`);
      }
      const approval = adrApprovalStatus(content);
      if (!approval.approved || approval.found === null || !/^approved\b/i.test(approval.found)) {
        return rejected(
          `${field}.stem`,
          `an ADR with status APPROVED is required; ${reference.stem} has status ${approval.found ?? 'missing'}`,
        );
      }
      const decisions = parseAdrDecisions(content);
      if (decisions.kind !== 'decisions' || !decisions.ids.has(String(reference.decision))) {
        const ids = decisions.kind === 'decisions'
          ? [...decisions.ids].sort((left, right) => Number(left) - Number(right)).join(', ')
          : 'none';
        return rejected(
          `${field}.decision`,
          `one of ADR ${reference.stem} declared decision ids ${ids} is required`,
        );
      }
      continue;
    }

    if (!activePlanRead) {
      const activePlan = await readActivePlanText(worktree);
      activePlanTaskIds = activePlan === undefined
        ? undefined
        : new Set(parsePlanTaskBodies(activePlan).keys());
      activePlanRead = true;
    }
    if (activePlanTaskIds === undefined) {
      return rejected(`${field}.taskId`, `an active plan declaring task ${reference.taskId} is required`);
    }
    const resolution = resolvePlanTaskReference(reference.taskId, activePlanTaskIds);
    if (resolution.kind === 'malformed') {
      return rejected(`${field}.taskId`, 'a task id matching the shared active-plan grammar is required');
    }
    if (resolution.kind === 'unresolvable') {
      return rejected(
        `${field}.taskId`,
        `plan task ${resolution.ids.join(', ')} is not declared by the active plan`,
      );
    }
  }

  return { ok: true, verdict };
}
