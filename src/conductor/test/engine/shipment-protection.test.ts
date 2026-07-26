import { describe, expect, it, vi } from 'vitest';

import {
  configureShipmentProtection,
  planShipmentProtection,
} from '../../src/engine/shipment-protection.js';

const baselineRuleset = () => ({
  id: 15933604,
  name: 'main protection',
  target: 'branch',
  enforcement: 'active',
  conditions: {
    ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] },
  },
  bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
  rules: [
    { type: 'deletion' },
    { type: 'non_fast_forward' },
    { type: 'creation' },
    { type: 'update' },
    {
      type: 'pull_request',
      parameters: {
        required_approving_review_count: 1,
        require_code_owner_review: true,
        allowed_merge_methods: ['squash'],
      },
    },
    {
      type: 'required_status_checks',
      parameters: {
        strict_required_status_checks_policy: false,
        required_status_checks: [{ context: 'ci-gate', integration_id: 41 }],
      },
    },
  ],
});

describe('shipment protection', () => {
  it('adds only the stable shipped-record context to a complete ruleset snapshot', () => {
    const before = baselineRuleset();
    const unchangedBefore = structuredClone(before);
    const plan = planShipmentProtection(before);

    expect({ plan, before }).toEqual({
      plan: {
        changed: true,
        before: unchangedBefore,
        after: {
          ...unchangedBefore,
          rules: [
            ...unchangedBefore.rules.slice(0, -1),
            {
              type: 'required_status_checks',
              parameters: {
                strict_required_status_checks_policy: false,
                required_status_checks: [
                  { context: 'ci-gate', integration_id: 41 },
                  { context: 'shipped-record' },
                ],
              },
            },
          ],
        },
      },
      before: unchangedBefore,
    });
  });

  it('refuses an apply before the shipped-record context has been observed', async () => {
    const ruleset = baselineRuleset();
    const updateRuleset = vi.fn();
    const result = await configureShipmentProtection(
      { mode: 'apply', contextObserved: false },
      {
        readRuleset: vi.fn(async () => ruleset),
        updateRuleset,
      },
    );

    expect({ result, updateCalls: updateRuleset.mock.calls.length }).toEqual({
      result: { kind: 'refused', code: 'shipped-record-context-unobserved' },
      updateCalls: 0,
    });
  });

  it('does not rewrite a ruleset that already requires shipped-record', async () => {
    const ruleset = planShipmentProtection(baselineRuleset()).after;
    const updateRuleset = vi.fn();
    const result = await configureShipmentProtection(
      { mode: 'apply', contextObserved: true },
      {
        readRuleset: vi.fn(async () => ruleset),
        updateRuleset,
      },
    );

    expect({ kind: result.kind, updateCalls: updateRuleset.mock.calls.length }).toEqual({
      kind: 'applied',
      updateCalls: 0,
    });
  });

  it('adds the required-status rule when the observed ruleset has none', () => {
    const before = baselineRuleset();
    before.rules.pop();

    expect(planShipmentProtection(before).after.rules.at(-1)).toEqual({
      type: 'required_status_checks',
      parameters: {
        required_status_checks: [{ context: 'shipped-record' }],
      },
    });
  });

  it('re-reads an applied ruleset and preserves the complete update inventory', async () => {
    const before = baselineRuleset();
    const after = planShipmentProtection(before).after;
    const readRuleset = vi.fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    const updateRuleset = vi.fn();
    const result = await configureShipmentProtection(
      { mode: 'apply', contextObserved: true },
      { readRuleset, updateRuleset },
    );

    expect({ result, update: updateRuleset.mock.calls[0] }).toEqual({
      result: {
        kind: 'applied',
        plan: { changed: true, before, after },
        after,
      },
      update: [
        '15933604',
        {
          name: before.name,
          target: before.target,
          enforcement: before.enforcement,
          conditions: before.conditions,
          bypass_actors: before.bypass_actors,
          rules: after.rules,
        },
      ],
    });
  });

  it('accepts a re-read ruleset when only GitHub response metadata changed', async () => {
    const before = { ...baselineRuleset(), updated_at: '2026-07-25T00:00:00Z' };
    const after = {
      ...planShipmentProtection(before).after,
      updated_at: '2026-07-25T00:01:00Z',
    };
    const readRuleset = vi.fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    const result = await configureShipmentProtection(
      { mode: 'apply', contextObserved: true },
      { readRuleset, updateRuleset: vi.fn() },
    );

    expect(result.kind).toBe('applied');
  });

  it('refuses an applied snapshot that drops an existing protection rule', async () => {
    const before = baselineRuleset();
    const drifted = planShipmentProtection(before).after;
    drifted.rules = drifted.rules.filter((rule) => rule.type !== 'deletion');
    const readRuleset = vi.fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(drifted);
    const updateRuleset = vi.fn();
    const result = await configureShipmentProtection(
      { mode: 'apply', contextObserved: true },
      { readRuleset, updateRuleset },
    );

    expect({ result, updateCalls: updateRuleset.mock.calls.length }).toEqual({
      result: { kind: 'refused', code: 'ruleset-drift' },
      updateCalls: 1,
    });
  });

  it('refuses an applied snapshot that changes the existing bypass actors', async () => {
    const before = baselineRuleset();
    const drifted = planShipmentProtection(before).after;
    drifted.bypass_actors = [];
    const readRuleset = vi.fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(drifted);
    const updateRuleset = vi.fn();
    const result = await configureShipmentProtection(
      { mode: 'apply', contextObserved: true },
      { readRuleset, updateRuleset },
    );

    expect({ result, updateCalls: updateRuleset.mock.calls.length }).toEqual({
      result: { kind: 'refused', code: 'ruleset-drift' },
      updateCalls: 1,
    });
  });
});
