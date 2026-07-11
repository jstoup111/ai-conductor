/**
 * Attribution verifier prompt assembly.
 *
 * Assembles the instruction set for the fresh-session semantic attribution
 * verifier. The prompt carries the exact verdict schema (schema 1), the
 * whitewash guard (satisfied requires non-empty citations + exit 0 test evidence),
 * instructions for running scoped tests and recording command+exit, explicit
 * permission for split attribution across multiple satisfied tasks, and strict
 * file-write constraints (only .pipeline/attribution-verdict.json).
 *
 * This is the ONLY instruction set the input-starved verifier session sees.
 * It must never reference conductor state, task-status.json, maker-summary
 * artifacts, or maker-session internals — input isolation is the point.
 *
 * Pattern: mirror build-review-prompt.ts isolation model.
 */

/**
 * Attribution verifier input: assembled task sections + candidate commits.
 */
export interface AttributionPromptInputs {
  /** Residue task sections + candidate commits from attribution-inputs assembly. */
  prompt: string;
}

/**
 * Assemble the verifier's prompt from its structurally-isolated inputs
 * (residue tasks + candidate commits only).
 */
export function buildAttributionPrompt(inputs: AttributionPromptInputs): string {
  const { prompt } = inputs;

  return `You are reviewing semantic attribution for a multi-task implementation.
Your job is to match candidate commits to residue tasks, verifying that each
satisfied task has evidence: non-empty citations (git commits) and passing tests.

## Attribution Verdict Schema (schema: 1)

Write your verdict to \`.pipeline/attribution-verdict.json\` using exactly this JSON schema:

\`\`\`
{
  schema: 1,
  anchor: {
    head: "<git HEAD sha>",
    residue: [<task IDs as array>]
  },
  results: [
    {
      taskId: "<task ID>",
      verdict: 'satisfied' | 'unsatisfied' | 'no-verdict',
      citations: [
        { sha: "<commit sha>", rationale: "<one-line explanation>" }
      ],
      testEvidence: {
        command: "<exact test command run>",
        exit: 0,
        summary: "<optional test output summary>"
      },
      reason: "<optional human-readable reason if not satisfied>"
    }
  ]
}
\`\`\`

## Whitewash Guard (Coercion Rules)

For a **satisfied** verdict, you must provide BOTH:
1. **Non-empty citations array** — at least one commit (sha + rationale) that implements the task.
2. **Valid testEvidence** — a test run with exit code 0 (passing test).

If a verdict is marked "satisfied" but lacks either citations or valid testEvidence
(exit ≠ 0), the verdict will be automatically coerced to "no-verdict" by the framework.
This is intentional — fail-closed enforcement, no guessing.

## Task Verification Instructions

For each residue task:

1. **Run the task's scoped tests yourself** — do not trust any claim about test results
   other than what you observe firsthand by running tests in this session.
   Record the exact command and the exit code (0 for pass, non-zero for fail).

2. **Match candidate commits to tasks** — review the diffs for each candidate commit
   and determine which task(s) each one implements. A single commit may contribute
   to multiple tasks if the code changes serve multiple task requirements.

3. **Record split attribution** — if a single commit satisfies requirements for more
   than one task, you may attribute it to all satisfied tasks with appropriate
   rationales. Split attribution is explicitly allowed and expected when commits
   address multiple concerns.

4. **Classify unmatched commits** — if a candidate commit doesn't implement any
   residue task, mark that task as "unsatisfied" (if you have strong evidence it's
   not implemented) or "no-verdict" (if you're uncertain). Include a brief reason.

## File Write Constraints

You may **ONLY** write to one file: \`.pipeline/attribution-verdict.json\`

Forbidden: no other files may be written. Do not create files, modify sidecars,
commit to git, or push to remote. Do not run setup/build commands (run scoped tests only).

Violation of these constraints will cause the framework to reject your work.

## Residue Tasks and Candidate Commits

${prompt}
`;
}
