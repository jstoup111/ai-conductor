import { describe, it, expect } from 'vitest';
import { buildGraderPrompt } from '../../src/engine/build-review-prompt.js';

// ── build_review grader prompt assembly ──────────────────────────────────
//
// The prompt is the ONLY instruction set the input-starved grader session
// sees. It must carry the exact rubric wording from
// adr-2026-07-07-build-review-judgement-gate.md, the all-or-FAIL rule, the
// exact `.pipeline/build-review.json` schema, and the instruction to run the
// project's own test suite. It must NEVER leak maker-session internals
// (task-status, maker summary, transcript) — input isolation is the point.

describe('buildGraderPrompt', () => {
  const inputs = {
    diff: 'diff --git a/foo.ts b/foo.ts\n+console.log("hi")\n',
    planBody: '## Plan\n\nDo the thing.',
  };

  it('includes the three rubric items verbatim', () => {
    const prompt = buildGraderPrompt(inputs);

    expect(prompt).toContain(
      'every new/changed test would fail without the diff',
    );
    expect(prompt).toContain('diff scoped to the plan, no unrelated files');
    expect(prompt).toContain(
      'the change addresses the stated defect, not a symptom',
    );
  });

  it('states the all-or-FAIL rule', () => {
    const prompt = buildGraderPrompt(inputs);

    expect(prompt).toMatch(/PASS only if all three rubric items pass/i);
  });

  it('includes the exact JSON schema for .pipeline/build-review.json', () => {
    const prompt = buildGraderPrompt(inputs);

    expect(prompt).toContain('.pipeline/build-review.json');
    expect(prompt).toContain(
      "{ verdict: 'PASS' | 'FAIL', reasons: string[], rubric: { tautology: string, scope: string, rootCause: string } }",
    );
  });

  it('instructs the grader to run the project test suite itself', () => {
    const prompt = buildGraderPrompt(inputs);

    expect(prompt).toMatch(/run the project's test suite/i);
  });

  it('includes the diff and plan body', () => {
    const prompt = buildGraderPrompt(inputs);

    expect(prompt).toContain(inputs.diff);
    expect(prompt).toContain(inputs.planBody);
  });

  it('never references task-status, maker summary, or maker internal state', () => {
    const prompt = buildGraderPrompt(inputs);

    expect(prompt).not.toMatch(/task-status/i);
    expect(prompt).not.toMatch(/maker summary/i);
    expect(prompt).not.toMatch(/maker session/i);
    expect(prompt).not.toMatch(/transcript/i);
  });
});
