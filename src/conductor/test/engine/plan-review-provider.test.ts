// Covers: task:11
import { describe, expect, it } from 'vitest';
import { classifyIndependence, orderReviewerCandidates, resolveAuthoringHost } from '../../src/engine/plan-review-provider.js';

describe('plan-review provider selection', () => {
  it('resolves the launcher value, a catalog marker, or unknown without guessing', () => {
    expect(resolveAuthoringHost({ AI_CONDUCTOR_AUTHORING_PROVIDER: 'pi' })).toBe('pi');
    expect(resolveAuthoringHost({ CODEX_THREAD_ID: 'thread' })).toBe('codex');
    expect(resolveAuthoringHost({})).toBe('unknown');
  });

  it('prefers an explicitly pinned reviewer, then moves the known authoring host last', () => {
    const config = { llm_provider: ['claude', 'codex', 'pi'], steps: { plan_review: { llm_provider: 'pi' } } } as any;
    expect(orderReviewerCandidates({ config, host: 'claude' })).toEqual(['pi', 'codex', 'claude']);
    expect(orderReviewerCandidates({ config, host: 'unknown' })).toEqual(['pi', 'claude', 'codex']);
  });

  it('classifies cross-provider, same-provider, and an unresolved authoring host', () => {
    expect(classifyIndependence('claude', 'codex')).toBe('cross-provider');
    expect(classifyIndependence('claude', 'claude')).toBe('same-provider');
    expect(classifyIndependence('unknown', 'codex')).toBe('unknown-host');
  });
});
