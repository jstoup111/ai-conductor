import type { BuildReviewInputs } from './build-review-inputs.js';

// ── Grader prompt assembly (build_review) ────────────────────────────────
//
// This is the ONLY instruction set the input-starved build_review grader
// session sees. It must never reference the maker session's transcript,
// summary, or `.pipeline/task-status.json` — the grader judges the diff
// against the plan, not the maker's narrative about its own work.
// Rubric wording is taken verbatim from
// `.docs/decisions/adr-2026-07-07-build-review-judgement-gate.md`.

/**
 * Assemble the grader's prompt from its structurally-isolated inputs
 * (diff + plan body only).
 */
export function buildGraderPrompt(inputs: BuildReviewInputs): string {
  const { diff, planBody } = inputs;

  return `You are reviewing a code diff for build_review — a code-review grade,
NOT a full architectural review. Judge diff honesty only: whether the diff
that was submitted actually does what it claims. You are not evaluating
runtime behavior (that is manual_test's mandate) or product alignment (that
is prd_audit's mandate).

Score the diff against exactly these three rubric items:

1. Tautology: every new/changed test would fail without the diff.
2. Scope: diff scoped to the plan, no unrelated files.
3. Root cause: the change addresses the stated defect, not a symptom.

All-or-FAIL rule: PASS only if all three rubric items pass. If any one of the
three rubric items fails, the overall verdict is FAIL.

Before judging, run the project's test suite yourself and observe the output
firsthand — do not trust any claim about test results other than what you
see by running the suite in this session.

When you are done, write your verdict to \`.pipeline/build-review.json\` using
exactly this JSON schema:

{ verdict: 'PASS' | 'FAIL', reasons: string[], rubric: { tautology: string, scope: string, rootCause: string } }

Each rubric field is a one-line reason for that item's pass/fail judgement.
\`reasons\` lists the one-line reasons for any failing item(s); it may be
empty when the verdict is PASS.

## Diff to review

\`\`\`diff
${diff}
\`\`\`

## Approved plan

${planBody}
`;
}
