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
  const {
    diff,
    planBody,
    repairContext = [],
    acceptedWidenings = [],
    entryPoints = [],
    removalContext,
  } = inputs;
  const escapeEvidence = (value: string) => value.replaceAll('`', '\\`');
  const renderedRemovalContext = removalContext && (
    removalContext.deletedFiles.length + removalContext.removedDeclarations.length + removalContext.removedMembers.length > 0
  )
    ? [
        ...removalContext.deletedFiles.map((path) => `- Deleted file: ${escapeEvidence(path)}`),
        ...removalContext.removedDeclarations.map((name) => `- Removed exported declaration: ${escapeEvidence(name)}`),
        ...removalContext.removedMembers.map(({ declaration, member }) =>
          `- Removed member: ${escapeEvidence(declaration)}.${escapeEvidence(member)}`),
      ].join('\n')
    : '(none)';
  const renderedEntryPoints = entryPoints.length > 0
    ? entryPoints.map((entryPoint) => `- ${entryPoint}`).join('\n')
    : '(not-judged: config.wiring.entry_points is absent or empty; do not infer entry points)';
  const renderedRepairContext = repairContext.length > 0
    ? repairContext.map((repair) =>
        `- ${repair.id} [${repair.reason}]: ${repair.diagnostic}`,
      ).join('\n')
    : '(none)';
  const renderedAcceptedWidenings = acceptedWidenings.length > 0
    ? acceptedWidenings.map((widening) =>
        `- Path: ${widening.path}\n  Rationale: ${widening.rationale}\n  Task ${widening.taskId}\n  Commit SHA: ${widening.sha}`,
      ).join('\n')
    : '(none)';

  return `You are reviewing a code diff for build_review — a code-review grade,
NOT a full architectural review. Judge diff honesty only: whether the diff
that was submitted actually does what it claims. You are not evaluating
runtime behavior (that is manual_test's mandate) or product alignment (that
is prd_audit's mandate).

Score the diff against exactly these five rubric items:

1. Tautology: every new/changed test would fail without the diff.
2. Scope: diff scoped to the plan, no unrelated files. \`.docs/architecture/\`, \`.docs/plans/\`, \`.docs/specs/\`, and \`.docs/stories/\` are already-approved DECIDE artifacts; modification of one passes Scope only when the approved plan justifies it, otherwise it is a Scope failure.
3. Root cause: the change addresses the stated defect, not a symptom.
4. Completeness: every planned task's work is present in the diff.
5. Wiring: a static property of the diff — every new or changed production
surface is called from a path that reaches a configured production entry point.
This is code reachability as written, not runtime behavior; runtime behavior
remains manual_test's mandate.

For Wiring, use only these configured production entry points, rendered
verbatim below:

${renderedEntryPoints}

When entry points are not configured, report Wiring as not-judged and do not
infer entry points or fail the item on that undefined premise. A plan task's
own Steps may declare intentional non-wiring only when they explicitly state
that it ships scaffolding for a later task or feature; honor that declared
intent for those symbols. Silence is never an implicit waiver.

The engine supplies cumulative aggregate-failure context recorded after base
advances. It survives repeated rebases without relying on rewritten commit
SHAs or telemetry trailers. This context is evidence, not an exemption: judge
whether each apparently out-of-plan hunk directly repairs a recorded failure.
If it does, skip that hunk for Scope. For a changed test that directly repairs
recorded stale base-state expectations, skip the ordinary Tautology mutation
check and instead verify the pre-repair test fails against the rebased state
while the repaired test passes. Unmatched work remains subject to every rubric.

For a changed test to count as removal maintenance, all three conditions must
hold: (1) Engine-derived removal evidence contains a specific deleted file,
deleted export, or removed type member; (2) that test's changed lines reference
that specific removal; and (3) the change adds no assertion about behavior that
still exists after this diff. Evaluate this predicate per changed test, never
per diff: deleting something does not exempt every test it touches. A test that
also adds a new behavioral assertion is still measured normally on that assertion.

The Tautology exceptions are an explicitly closed list:
1. Rebase repair: use the Engine-recorded rebase repair context block and only
   the stale-base-state test rule stated above.
2. Removal maintenance: use the Engine-derived removal evidence block and only
   the three-condition per-test predicate stated above.
A changed test qualifying under neither exception is measured normally.

Completeness must be judged holistically: read the plan and the diff as a
whole and form a judgement of whether the diff, taken together, delivers
everything the plan describes. Do NOT reason about completeness on a
per-task basis — you must never chase individual task SHAs, verify
per-task commit reachability, or look for corroborating evidence tying
each plan task to a specific commit. That per-task SHA/reachability/
corroboration style of reasoning is explicitly forbidden for this rubric
item; it is the failure mode this gate exists to avoid reintroducing.

All-or-FAIL rule: PASS only if all five rubric items pass. If any one of the
five rubric items fails, the overall verdict is FAIL.

Before judging, run only the scoped tests exercised by this diff (the changed
test files) through \`conduct-ts scoped-run\` — observe their output firsthand.

When you are done, write your verdict to \`.pipeline/build-review.json\` using
exactly this JSON schema:

{ verdict: 'PASS' | 'FAIL', reasons: string[], findings?: { tautology?: string[], scope?: string[], rootCause?: string[], completeness?: string[], wiring?: string[] }, rubric: { tautology: boolean, scope: boolean, rootCause: boolean, completeness: boolean, wiring: boolean } }

Each \`rubric\` boolean marks whether that item failed. \`reasons\` remains a
backward-compatible one-line summary for each failing rubric item; it may be
empty when the verdict is PASS. When \`rubric.completeness\` fails, populate
\`findings.completeness\`; when \`rubric.wiring\` fails, populate
\`findings.wiring\`; use the matching \`findings.<rubric>\` key for the
other rubric items. Each findings list contains **every independent finding**
you observed for that item. Use one finding per array entry — do not compress multiple actionable
gaps into one summary. The list must be exhaustive for the diff and plan you
were given. For a PASS verdict, omit \`findings\` or leave it empty.

## Diff to review

\`\`\`diff
${diff}
\`\`\`

## Approved plan

${planBody}

## Engine-recorded rebase repair context

${renderedRepairContext}

## Engine-accepted scope widenings

These commit-local widenings passed the containment evaluator and are explicit
evidence, not exemptions, for the Scope rubric. Judge whether each rationale
actually justifies the widened path:

${renderedAcceptedWidenings}

## Engine-derived removal evidence

The following removals are diff-derived evidence, not an exemption. Evaluate
them only under the Tautology exception rules below:

${renderedRemovalContext}
`;
}
