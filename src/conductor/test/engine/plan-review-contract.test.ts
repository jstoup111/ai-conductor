// Covers: task:2
import { describe, expect, it } from 'vitest';

import { toCodexStrictSchema } from '../../src/execution/codex-strict-schema.js';
import {
  PLAN_REVIEW_RESULT_SCHEMA,
  validatePlanReviewResult,
} from '../../src/engine/plan-review-contract.js';

const context = {
  planText: '### Task 1: Build the contract\n\n### Task 2: Wire the contract',
  storiesText: '# Stories\n\n## Story 1\nThe contract is validated.',
  adrTexts: { 'adr-2026-10-10-review': '## Decision\nD1. Validate findings.' },
  sourceFiles: {
    'src/conductor/src/engine/contract.ts': 'export const contract = true;\n',
    'src/conductor/test/engine/contract.test.ts': 'expect(contract).toBe(true);\n',
  },
} as const;

function finding(lens: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `${lens}-1`,
    severity: 'significant',
    lens,
    artifact: '.docs/plans/example.md',
    reference: 'task 1',
    relatedReference: lens === 'dependency-order' ? 'task 2' : null,
    resolvesPrior: null,
    summary: 'The proposed behavior needs a source-grounded check.',
    evidence: lens === 'dependency-order'
      ? [
        'src/conductor/src/engine/contract.ts:1',
        'Dependency closure for task 1: none; task 2 is not reachable.',
      ]
      : ['src/conductor/src/engine/contract.ts:1'],
    ...overrides,
  };
}

describe('plan-review contract', () => {
  it.each(['test-impact', 'reachability', 'dependency-order', 'feasibility'])
  ('accepts a valid %s finding', (lens) => {
    expect(validatePlanReviewResult({ findings: [finding(lens)] }, context)).toMatchObject({
      kind: 'accepted', result: { findings: [{ lens }] },
    });
  });

  it.each(['reachability', 'dependency-order', 'contradiction'])('accepts plan-only evidence for %s', (lens) => {
    const result = validatePlanReviewResult({ findings: [finding(lens, {
      evidence: lens === 'contradiction'
        ? ['.docs/plans/example.md:1', '"Build the contract"', '"Wire the contract"']
        : lens === 'dependency-order'
          ? [
            '.docs/plans/example.md:1',
            'Dependency closure for task 1: none; task 2 is not reachable.',
          ]
          : ['.docs/plans/example.md:1'],
    })] }, { ...context, sourceFiles: { ...context.sourceFiles, '.docs/plans/example.md': context.planText } });
    expect(result.kind).toBe('accepted');
  });

  it.each([
    ['reachability', '.docs/stories/example.md'],
    ['dependency-order', '.docs/decisions/adr-example.md'],
    ['contradiction', '.docs/plans/example.md'],
  ])('accepts permitted .docs evidence for %s', (lens, path) => {
    const evidence = lens === 'contradiction'
      ? [`${path}:1`, '"Build the contract"', '"Wire the contract"']
      : lens === 'dependency-order'
        ? [`${path}:1`, 'Dependency closure for task 1: none; task 2 is not reachable.']
        : [`${path}:1`];
    const result = validatePlanReviewResult({ findings: [finding(lens, { evidence })] }, {
      ...context,
      sourceFiles: { ...context.sourceFiles, [path]: lens === 'reachability' ? context.storiesText : context.planText },
    });
    expect(result.kind).toBe('accepted');
  });

  it('accepts a contradiction only with two source-grounded quoted passages', () => {
    const result = validatePlanReviewResult({
      findings: [finding('contradiction', {
        evidence: [
          'src/conductor/src/engine/contract.ts:1',
          '"Build the contract"',
          '"Wire the contract"',
        ],
      })],
    }, context);

    expect(result.kind).toBe('accepted');
  });

  it.each([
    ['test-impact', ['"Build the contract"']],
    ['reachability', ['"Build the contract"']],
    ['feasibility', ['.docs/plans/example.md:1']],
    ['test-impact', ['.docs/plans/example.md:1']],
  ])('rejects %s evidence without a source file location', (lens, evidence) => {
    const result = validatePlanReviewResult({ findings: [finding(lens, { evidence })] }, context);

    expect(result).toMatchObject({ kind: 'rejected' });
    expect(result.kind === 'rejected' && result.diagnostics.join('\n')).toContain(`${lens}-1`);
    expect(result.kind === 'rejected' && result.diagnostics.join('\n')).toContain('evidence');
  });

  it('rejects an under-evidenced contradiction, invalid severity, malformed reference, and missing related task', () => {
    const result = validatePlanReviewResult({
      findings: [
        finding('contradiction', { evidence: ['src/conductor/src/engine/contract.ts:1', '"Build the contract"'] }),
        finding('reachability', { id: 'severity-1', severity: 'oscillation' }),
        finding('reachability', { id: 'reference-1', reference: 'criterion 1' }),
        finding('dependency-order', { id: 'dependency-1', relatedReference: null }),
      ],
    }, context);

    expect(result).toMatchObject({ kind: 'rejected' });
    const diagnostics = result.kind === 'rejected' ? result.diagnostics.join('\n') : '';
    expect(diagnostics).toContain('contradiction-1');
    expect(diagnostics).toContain('severity-1');
    expect(diagnostics).toContain('reference-1');
    expect(diagnostics).toContain('dependency-1');
  });

  it('accepts a dependency-order finding with its transitive closure and an unreachable related task', () => {
    const result = validatePlanReviewResult({ findings: [finding('dependency-order', {
      evidence: [
        'src/conductor/src/engine/contract.ts:1',
        'Dependency closure for task 1: task 3 -> task 4; task 2 is not reachable.',
      ],
    })] }, context);

    expect(result.kind).toBe('accepted');
  });

  it('rejects a dependency-order finding without dependency-closure evidence', () => {
    const result = validatePlanReviewResult({ findings: [finding('dependency-order', {
      evidence: ['src/conductor/src/engine/contract.ts:1'],
    })] }, context);

    expect(result).toMatchObject({ kind: 'rejected' });
    expect(result.kind === 'rejected' && result.diagnostics.join('\n')).toContain('dependency-order-1.evidence requires dependency-closure evidence');
  });

  it('rejects a dependency-order finding that calls the same task a second task', () => {
    const result = validatePlanReviewResult({ findings: [finding('dependency-order', {
      relatedReference: 'Task 1',
    })] }, context);
    expect(result.kind).toBe('rejected');
    expect(result.kind === 'rejected' && result.diagnostics.join('\n')).toContain('second task');
  });

  it('is already Codex strict-compatible and serializes unchanged for Pi schema files', () => {
    expect(toCodexStrictSchema(PLAN_REVIEW_RESULT_SCHEMA)).toEqual(PLAN_REVIEW_RESULT_SCHEMA);
    expect(JSON.parse(JSON.stringify(PLAN_REVIEW_RESULT_SCHEMA))).toEqual(PLAN_REVIEW_RESULT_SCHEMA);
  });
});
