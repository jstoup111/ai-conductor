import { describe, it, expect } from 'vitest';
import { buildGraderPrompt } from '../../src/engine/build-review-prompt.js';
import type { BuildReviewInputs } from '../../src/engine/build-review-inputs.js';

// ── build_review grader prompt assembly ──────────────────────────────────
//
// The prompt is the ONLY instruction set the input-starved grader session
// sees. It must carry the exact rubric wording from
// adr-2026-07-07-build-review-judgement-gate.md, the all-or-FAIL rule, the
// exact `.pipeline/build-review.json` schema, and the instruction to run the
// project's own test suite. It must NEVER leak maker-session internals
// (task-status, maker summary, transcript) — input isolation is the point.

describe('buildGraderPrompt', () => {
  // `buildGraderPrompt` only reads `diff`/`planBody`; the remaining fields
  // exist on BuildReviewInputs for the caller's provenance bookkeeping, not
  // for prompt assembly — filled with fallback-shaped values here since
  // these tests don't exercise the merge-base/freshness plumbing.
  const inputs: BuildReviewInputs = {
    diff: 'diff --git a/foo.ts b/foo.ts\n+console.log("hi")\n',
    planBody: '## Plan\n\nDo the thing.',
    mergeBase: 'deadbeef',
    baseRef: 'main',
    baseKind: 'local',
    trackingRefSha: null,
    remoteHeadSha: null,
    fresh: false,
  };

  it('includes the original rubric items verbatim', () => {
    const prompt = buildGraderPrompt(inputs);

    expect(prompt).toContain(
      'every new/changed test would fail without the diff',
    );
    expect(prompt).toContain('diff scoped to the plan, no unrelated files');
    expect(prompt).toContain(
      'the change addresses the stated defect, not a symptom',
    );
  });

  it('renders every configured wiring entry point verbatim', () => {
    const entryPoints = [
      'src/conductor/src/index.ts',
      'src/conductor/src/daemon-cli.ts',
      'src/conductor/src/engine/engineer-cli.ts',
    ];
    const prompt = buildGraderPrompt({
      ...inputs,
      entryPoints,
    } as BuildReviewInputs & { entryPoints: string[] });

    expect(entryPoints.every((entryPoint) => prompt.includes(entryPoint))).toBe(true);
  });

  it('marks wiring as not-judged when entry points are absent or empty', () => {
    const prompts = [
      buildGraderPrompt(inputs),
      buildGraderPrompt({
        ...inputs,
        entryPoints: [],
      } as BuildReviewInputs & { entryPoints: string[] }),
    ];

    expect(prompts.every((prompt) => /wiring[\s\S]*not-judged/i.test(prompt))).toBe(true);
  });

  it('treats approved DECIDE artifacts as plan-governed Scope changes', () => {
    const prompt = buildGraderPrompt(inputs);

    expect(prompt).toMatch(
      /Scope:.*\.docs\/architecture\/.*\.docs\/plans\/.*\.docs\/specs\/.*\.docs\/stories\/.*already-approved DECIDE artifacts.*modification.*passes Scope only.*approved plan justifies it.*otherwise.*Scope failure/is,
    );
  });

  it('asks the grader to judge recorded rebase repairs separately without granting an automatic exemption', () => {
    const prompt = buildGraderPrompt({
      ...inputs,
      repairContext: [{
        id: 'repair-abc123def456',
        reason: 'command_failed',
        diagnostic: 'stale aggregate command expectation',
        rebaseInvalidatedAt: 101,
      }],
    });

    expect(prompt).toMatch(/context is evidence, not an exemption/i);
    expect(prompt).toMatch(/judge[\s\S]*directly repairs/i);
    expect(prompt).toMatch(/skip that hunk for Scope/i);
    expect(prompt).toMatch(/skip the ordinary Tautology mutation/i);
    expect(prompt).toContain('repair-abc123def456');
  });

  it('states the all-or-FAIL rule', () => {
    const prompt = buildGraderPrompt(inputs);

    expect(prompt).toMatch(/PASS only if all five rubric items pass/i);
  });

  it('lists five rubric items and applies all-or-FAIL across all five', () => {
    const prompt = buildGraderPrompt({
      ...inputs,
      entryPoints: ['src/conductor/src/index.ts'],
    });

    expect(prompt).toMatch(/Score the diff against exactly these five rubric items/i);
    expect(prompt).toMatch(/5\. Wiring:/);
    expect(prompt).toMatch(/PASS only if all five rubric items pass/i);
  });

  it('judges wiring as static reachability while reserving runtime behavior for manual_test', () => {
    const prompt = buildGraderPrompt({
      ...inputs,
      entryPoints: ['src/conductor/src/index.ts'],
    });

    expect(prompt).toMatch(/Wiring:.*static.*diff/is);
    expect(prompt).toMatch(/path.*reaches.*configured production entry point/is);
    expect(prompt).toContain("not evaluating\nruntime behavior (that is manual_test's mandate)");
  });

  it('honors only an explicit Steps statement as intentional non-wiring', () => {
    const prompt = buildGraderPrompt({
      ...inputs,
      entryPoints: ['src/conductor/src/index.ts'],
    });

    expect(prompt).toContain("A plan task's\nown Steps may declare intentional non-wiring only when they explicitly state\nthat it ships scaffolding for a later task or feature");
    expect(prompt).toContain('Silence is never an implicit waiver.');
  });

  it('includes the exact JSON schema for .pipeline/build-review.json', () => {
    const prompt = buildGraderPrompt(inputs);

    expect(prompt).toContain('.pipeline/build-review.json');
    expect(prompt).toContain(
      "{ verdict: 'PASS' | 'FAIL', reasons: string[], findings?: { tautology?: string[], scope?: string[], rootCause?: string[], completeness?: string[], wiring?: string[] }, rubric: { tautology: boolean, scope: boolean, rootCause: boolean, completeness: boolean, wiring: boolean } }",
    );
  });

  it('includes wiring in the JSON verdict schema', () => {
    const prompt = buildGraderPrompt({
      ...inputs,
      entryPoints: ['src/conductor/src/index.ts'],
    });

    expect(prompt).toContain('wiring?: string[]');
    expect(prompt).toContain('wiring: boolean');
  });

  it('requires every independent failed-rubric finding in a structured list', () => {
    const prompt = buildGraderPrompt(inputs);

    expect(prompt).toMatch(/every independent finding/i);
    expect(prompt).toMatch(/findings/i);
    expect(prompt).toMatch(/one finding per array entry/i);
  });

  it('instructs the grader to run the project test suite itself', () => {
    const prompt = buildGraderPrompt(inputs);

    expect(prompt).toMatch(/scoped tests?/i);
    expect(prompt).not.toMatch(/run the project's (full |entire )?test suite/i);
  });

  it('directs the grader to the scoped-run interface without stale full-suite ownership', () => {
    const prompt = buildGraderPrompt(inputs);

    expect(prompt).toContain('conduct-ts scoped-run');
    expect(prompt).not.toContain('The full project suite runs at CI and at finish, not here.');
  });

  it('includes the completeness rubric item and forbids per-task reasoning', () => {
    const prompt = buildGraderPrompt(inputs);

    expect(prompt).toContain(
      'Completeness: every planned task\'s work is present in the diff',
    );
    expect(prompt).toMatch(
      /completeness .*(judg(e|ed|ement)|assess(ed)?) holistically/i,
    );
    expect(prompt).toMatch(
      /(do not|must not|never).*(per-task|SHA|reachability|corroboration)/i,
    );
    expect(prompt).toMatch(/findings\.completeness/);
    expect(prompt).toMatch(/PASS only if all five rubric items pass/i);
  });

  it('includes the diff and plan body', () => {
    const prompt = buildGraderPrompt(inputs);

    expect(prompt).toContain(inputs.diff);
    expect(prompt).toContain(inputs.planBody);
  });

  it('renders accepted scope widenings with path, rationale, task id, and commit sha', () => {
    const prompt = buildGraderPrompt({
      ...inputs,
      acceptedWidenings: [{
        path: 'src/conductor/src/engine/shared.ts',
        rationale: 'the shared parser is an atomic dependency',
        taskId: '12',
        sha: 'abc123def456',
      }, {
        path: 'docs/reference/cli.md',
        rationale: 'the command contract must stay synchronized',
        taskId: '14',
        sha: 'fed987cba654',
      }],
    } as BuildReviewInputs & {
      acceptedWidenings: Array<{
        path: string;
        rationale: string;
        taskId: string;
        sha: string;
      }>;
    });

    expect(prompt).toContain('src/conductor/src/engine/shared.ts');
    expect(prompt).toContain('the shared parser is an atomic dependency');
    expect(prompt).toContain('Task 12');
    expect(prompt).toContain('abc123def456');
    expect(prompt).toContain('docs/reference/cli.md');
    expect(prompt).toContain('the command contract must stay synchronized');
    expect(prompt).toContain('Task 14');
    expect(prompt).toContain('fed987cba654');
  });

  it('renders populated and empty removal evidence as evidence, escaping backticks', () => {
    const populated = buildGraderPrompt({
      ...inputs,
      removalContext: { deletedFiles: ['src/old`file.ts'], removedDeclarations: ['OldApi'], removedMembers: [{ declaration: 'Contract', member: 'oldField' }] },
    });
    const empty = buildGraderPrompt({
      ...inputs,
      removalContext: { deletedFiles: [], removedDeclarations: [], removedMembers: [] },
    });
    expect(populated).toMatch(/removal evidence/i);
    expect(populated).toMatch(/evidence,? not an exemption/i);
    expect(populated).toContain('src/old\\`file.ts');
    expect(populated).toContain('OldApi');
    expect(populated).toContain('Contract.oldField');
    expect(empty).toMatch(/Engine-derived removal evidence[\s\S]*\(none\)/);
  });

  it('defines removal maintenance through all three per-test conditions', () => {
    const prompt = buildGraderPrompt(inputs);
    expect(prompt).toMatch(/all three conditions/i);
    expect(prompt).toMatch(/specific deleted file[\s\S]*deleted export[\s\S]*removed type member/i);
    expect(prompt).toMatch(/changed lines reference[\s\S]*specific removal/i);
    expect(prompt).toMatch(/adds no assertion about behavior that[\s\S]*still exists/i);
    expect(prompt).toMatch(/per changed test, never[\s\S]*per diff/i);
    expect(prompt).toMatch(/adds a new behavioral assertion[\s\S]*measured normally/i);
  });

  it('renders the two Tautology exceptions as an explicitly closed list', () => {
    const prompt = buildGraderPrompt(inputs);
    const exceptions = prompt.match(/The Tautology exceptions are an explicitly closed list:[\s\S]*?measured normally\./)?.[0] ?? '';
    expect(exceptions).toMatch(/1\. Rebase repair:[\s\S]*Engine-recorded rebase repair context block/i);
    expect(exceptions).toMatch(/2\. Removal maintenance:[\s\S]*Engine-derived removal evidence block/i);
    expect(exceptions).toMatch(/qualifying under neither exception is measured normally/i);
    expect((exceptions.match(/^\d\. /gm) ?? [])).toHaveLength(2);
  });

  it('leaves every non-Tautology rubric item and the all-or-FAIL rule intact', () => {
    const prompt = buildGraderPrompt(inputs);
    const rubric = prompt.match(/Score the diff against exactly these (\w+) rubric items:\n([\s\S]*?)\n\nFor Wiring/)?.[2] ?? '';
    const items = [...rubric.matchAll(/^\d+\. ([^:]+): ([\s\S]*?)(?=\n\d+\.|$)/gm)];
    const nonTautology = items.filter(([, name]) => name !== 'Tautology').map(([, name, text]) => `${name}: ${text}`);
    expect(nonTautology).toEqual(expect.arrayContaining([
      expect.stringContaining('Scope: diff scoped to the plan, no unrelated files.'),
      expect.stringContaining('Root cause: the change addresses the stated defect, not a symptom.'),
      expect.stringContaining("Completeness: every planned task's work is present in the diff."),
      expect.stringContaining('Wiring: a static property of the diff'),
    ]));
    const rubricCount = prompt.match(/exactly these (\w+) rubric items/)?.[1];
    expect(rubricCount).toBeTruthy();
    expect(prompt).toContain(`PASS only if all ${rubricCount} rubric items pass.`);

    const removalBlock = prompt.match(/## Engine-derived removal evidence\n([\s\S]*?)$/)?.[1] ?? '';
    expect(removalBlock).not.toMatch(/\b(?:Claude|Codex|Agent tool|\/\w+|\$\w+)\b/i);
    expect(removalBlock).not.toMatch(/transcript|maker summary|task-status/i);
  });


  it('never references task-status, maker summary, or maker internal state', () => {
    const prompt = buildGraderPrompt(inputs);

    expect(prompt).not.toMatch(/task-status/i);
    expect(prompt).not.toMatch(/maker summary/i);
    expect(prompt).not.toMatch(/maker session/i);
    expect(prompt).not.toMatch(/transcript/i);
  });
});
