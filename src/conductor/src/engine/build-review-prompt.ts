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

Score the diff against exactly these four rubric items:

1. Tautology: every new/changed test would fail without the diff.
2. Scope: diff scoped to the plan, no unrelated files.
3. Root cause: the change addresses the stated defect, not a symptom.
4. Completeness: every planned task's work is present in the diff.

Completeness must be judged holistically: read the plan and the diff as a
whole and form a judgement of whether the diff, taken together, delivers
everything the plan describes. Do NOT reason about completeness on a
per-task basis — you must never chase individual task SHAs, verify
per-task commit reachability, or look for corroborating evidence tying
each plan task to a specific commit. That per-task SHA/reachability/
corroboration style of reasoning is explicitly forbidden for this rubric
item; it is the failure mode this gate exists to avoid reintroducing.

All-or-FAIL rule: PASS only if all four rubric items pass. If any one of the
four rubric items fails, the overall verdict is FAIL.

Before judging, run only the scoped tests exercised by this diff (the changed
test files) — observe their output firsthand. The full project suite runs at
CI and at finish, not here.

When you are done, write your verdict to \`.pipeline/build-review.json\` using
exactly this JSON schema:

{ verdict: 'PASS' | 'FAIL', reasons: string[], rubric: { tautology: string, scope: string, rootCause: string, completeness: string } }

Each rubric field is a one-line reason for that item's pass/fail judgement,
including \`rubric.completeness\`, the one-line reason for the completeness
item's holistic pass/fail judgement.
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
