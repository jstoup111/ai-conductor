// Covers: task:24
import { describe, expect, it, vi } from 'vitest';

import {
  RESIDUE_ROUTING_CALL_CONTRACT_VERSION,
  RESIDUE_ROUTING_CALL_SCHEMA,
  RESIDUE_ROUTING_MAX_ATTEMPTS,
  parseResidueRoutingAnswer,
  resolveResidueOwner,
  runResidueRoutingCall,
} from '../../../src/engine/routing/residue-routing-call.js';
import { PRD_AUDIT_JUDGMENT_SCHEMA } from '../../../src/engine/prd-audit-contract.js';
import { AS_BUILT_VERDICT_SCHEMA } from '../../../src/engine/as-built-contract.js';

const items = [
  { itemId: 'finding-1', summary: 'ADR decision D2 requires routing.' },
  { itemId: 'finding-2', summary: 'Manual-test obligation.' },
] as const;
const declaredPositions = [1, 2, 3] as const;

const validAnswer = JSON.stringify({
  version: RESIDUE_ROUTING_CALL_CONTRACT_VERSION,
  items: [
    { itemId: 'finding-1', child: 1, candidates: [1], rationale: 'The first child owns the ADR decision.' },
    { itemId: 'finding-2', child: 3, candidates: [3], rationale: 'The leaf owns the manual test obligation.' },
  ],
});

describe('residue routing call', () => {
  it('owns a distinct versioned schema that requires every item routing field', () => {
    expect(RESIDUE_ROUTING_CALL_SCHEMA).not.toBe(PRD_AUDIT_JUDGMENT_SCHEMA);
    expect(RESIDUE_ROUTING_CALL_SCHEMA).not.toBe(AS_BUILT_VERDICT_SCHEMA);
    expect(RESIDUE_ROUTING_CALL_SCHEMA.properties.version.const).toBe(RESIDUE_ROUTING_CALL_CONTRACT_VERSION);

    const itemSchema = RESIDUE_ROUTING_CALL_SCHEMA.properties.items.items;
    expect(itemSchema.required).toEqual(expect.arrayContaining(['itemId', 'child', 'candidates', 'rationale']));
  });

  it('accepts a schema-valid answer for every supplied residue item', () => {
    expect(parseResidueRoutingAnswer(validAnswer, items, declaredPositions)).toEqual([
      expect.objectContaining({ kind: 'valid', itemId: 'finding-1', child: 1, candidates: [1] }),
      expect.objectContaining({ kind: 'valid', itemId: 'finding-2', child: 3, candidates: [3] }),
    ]);
  });

  it.each([
    ['an undeclared child', JSON.stringify({ version: RESIDUE_ROUTING_CALL_CONTRACT_VERSION, items: [
      { itemId: 'finding-1', child: 7, candidates: [1], rationale: 'wrong position' },
      { itemId: 'finding-2', child: 3, candidates: [3], rationale: 'valid' },
    ] })],
    ['an undeclared candidate', JSON.stringify({ version: RESIDUE_ROUTING_CALL_CONTRACT_VERSION, items: [
      { itemId: 'finding-1', child: 1, candidates: [1, 7], rationale: 'wrong position' },
      { itemId: 'finding-2', child: 3, candidates: [3], rationale: 'valid' },
    ] })],
  ])('classifies %s as invalid-position', (_label, output) => {
    expect(parseResidueRoutingAnswer(output, items, declaredPositions)[0]).toMatchObject({
      kind: 'invalid-position', itemId: 'finding-1',
    });
  });

  it.each([
    'not JSON',
    JSON.stringify({ version: RESIDUE_ROUTING_CALL_CONTRACT_VERSION, items: [
      { itemId: 'finding-1', child: 1, candidates: [1] },
      { itemId: 'finding-2', child: 3, candidates: [3], rationale: 'valid' },
    ] }),
  ])('classifies %j as malformed', (output) => {
    expect(parseResidueRoutingAnswer(output, items, declaredPositions)[0]).toMatchObject({
      kind: 'malformed', itemId: 'finding-1',
    });
  });

  it('calls the judge once with every residue item when its first answer is valid', async () => {
    const judge = vi.fn<(prompt: string) => Promise<{ success: boolean; output: string }>>(async () => ({ success: true, output: validAnswer }));

    await expect(runResidueRoutingCall({ items, declaredPositions, judge })).resolves.toMatchObject({ kind: 'routed' });

    expect(judge).toHaveBeenCalledOnce();
    expect(judge.mock.calls[0]![0]).toContain('finding-1');
    expect(judge.mock.calls[0]![0]).toContain('finding-2');
  });

  it('re-asks the complete round up to its independent two-attempt budget', async () => {
    const judge = vi.fn<(prompt: string) => Promise<{ success: boolean; output: string }>>(async () => ({ success: true, output: 'not JSON' }));

    await expect(runResidueRoutingCall({ items, declaredPositions, judge })).resolves.toMatchObject({
      kind: 'halt', itemId: 'finding-1',
    });

    expect(judge).toHaveBeenCalledTimes(RESIDUE_ROUTING_MAX_ATTEMPTS);
  });

  it('retains the judgement rationale for direct and default residue ownership', () => {
    expect(resolveResidueOwner({ itemId: 'finding-1', child: 2, candidates: [2], rationale: 'implements D2' }))
      .toEqual({ owner: 2, reason: 'residue-judged', rationale: 'implements D2' });
    expect(resolveResidueOwner({ itemId: 'finding-1', child: 2, candidates: [1, 2], rationale: 'ambiguous ownership' }))
      .toEqual({ owner: 1, reason: 'residue-default', rationale: 'ambiguous ownership' });
  });

  it('halts without a judge and preserves the independent routing-call budget', async () => {
    await expect(runResidueRoutingCall({ items: [items[0]!], declaredPositions }))
      .resolves.toEqual({ kind: 'halt', itemId: 'finding-1', detail: 'no residue routing judge available' });
  });
});
