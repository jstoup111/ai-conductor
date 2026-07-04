# Architecture Review: finish-time rehabilitation of reused needs-remediation halt PRs
**Date:** 2026-07-03
**Mode:** lightweight (Tier M, technical track) — feasibility + alignment
**Input reviewed:** explore output + approved Approach C (#271); diagrams
`finish-should-rewrite-stale-needs-remediation-titl.md` + `sequences/halt-pr-rehabilitation.md`;
stories do not exist yet
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **All mechanics already exist as tested primitives** in `pr-labels.ts`:
  `setReady` (draft→ready), `removeLabel` (REST, Projects-classic-safe),
  `upsertComment`; and `injectIssueRef` in `engineer/issue-ref.ts` (idempotent
  `Closes` — "present exactly once" comes free). The new engine step is
  composition, not new gh plumbing.
- **Call site exists:** `daemon-cli.ts` already runs
  `closeIssueOnImplementationMerge` post-`conductor.run()` with `sourceRef` +
  recorded `pr_url` in scope — the rehabilitation step slots in beside it (or
  absorbs it; see ADR).
- **Finish gate seam exists:** the finish completion check
  (`artifacts.ts` `FINISH_CHOICE_MARKER` block, ~line 625) already verifies a
  fresh `finish-choice` and `pr_url` for choice="pr"; extending it to also read
  the recorded PR's `title`/`isDraft`/`labels` via `gh pr view --json` is
  additive. This introduces a **network read into a gate** — see Conditions.
- **Detection is stateless:** "born as a halt PR" is detected from observable
  PR state (title prefix `needs-remediation:`, label, draft), never from
  history or extra local state. Deterministic and testable with injected
  runners.
- **Skill side:** `/pr` SKILL.md already mandates `gh pr edit` when the PR
  exists; the change is an explicit halt-PR-rehabilitation step in
  `/finish`/`/pr` (contract wording), not new skill machinery.

## Alignment

- **ADR-001 (no-dispatch keystone):** untouched — no new dispatch path; the
  step runs inside an existing feature's finish tail.
- **ADR-005/ADR-010 (daemon never merges):** preserved — rehabilitation edits
  presentation/state of the PR; merge remains human-only. Flipping draft→ready
  does not merge.
- **adr-013 (main-advance rekick):** untouched.
- **daemon-pr-labels (FR-12, `mergeable-sweep.ts:152`):** *reinforcing* — the
  sweep suppresses `mergeable` while `needs-remediation` is present, so
  clearing the label at finish is REQUIRED for the mergeable watch to ever
  flag a rehabilitated PR. Today's behavior (stale label survives ship) starves
  FR-10 on reused halt PRs; this feature fixes that interaction.
- **Issue #274 (birth-side label/draft verify-after-write):** adjacent,
  explicitly out of scope; this feature only touches the finish side. No
  contradiction — both converge on "PR state must match feature state".
- **Fix-the-skill convention (#161 precedent):** honored — presentation is
  owned by the skill; the engine only enforces (gate) and executes mechanics
  that were already engine-owned primitives.
- **Degradation semantics:** mechanics are warn-only and never block the ship,
  mirroring `conduct shipped-record` (C2 of the dedup review). Consistent
  error-handling pattern, no new convention introduced.
- **Worktree isolation:** no new services, ports, DBs, or shared state; gh
  calls are per-worktree cwd. Two concurrent worktrees cannot contend.

## Domain Integrity

(Lightweight mode — deferred to TDD domain reviews.) One note: model the
rehabilitation outcome as a discriminated result (e.g.
`'not-halt-pr' | 'rehabilitated' | 'partial' | 'gh-unavailable'`), not
booleans, so partial failures are representable and loggable.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| gh outage inside the finish completion check burns retries → HALT on an otherwise-shipped feature | Integration | Low | High | fail-open on gh READ errors (warn + pass); the check is strict only on a successful read showing stale presentation |
| Skill repeatedly fails to rewrite title/body → bounded retries exhaust → HALT | Technical | Low | Medium | existing per-step retry cap applies; HALT is correct (presentation demonstrably stale); reason names the exact stale field |
| Label clear races the mergeable-sweep tick | Integration | Low | Low | both paths are idempotent (`removeLabel` tolerates absent label; sweep re-reads state next tick) |
| `Closes` injection wrong/missing when spec has no sourceRef | Data | Low | Low | existing `no-source-ref` gating in `closeIssueOnImplementationMerge` unchanged; negative-path story required |
| Rewritten body loses halt history | Knowledge | Low | Low | halt reason lives in the PR comment thread (birth-side comment), which the rewrite never touches |

## ADRs Created

- `adr-2026-07-03-halt-pr-rehabilitation-at-finish.md` (DRAFT → requires
  operator approval before stories)

## Conditions

1. **Fail-open gate reads:** the finish completion check treats a `gh pr view`
   FAILURE as pass-with-warn (network never blocks a ship); it fails the step
   only when a successful read shows needs-remediation title, label, or draft
   state on the recorded PR.
2. **Stateless detection only:** halt-PR origin is derived from observable PR
   state; no new local marker files or ledger entries.
3. **Mechanics warn-only:** ready-flip/label-clear/Closes failures log and
   never fail the finish step (mirrors shipped-record degradation).
4. **Negative-path stories required** for: gh view failure in the gate, gh
   mutation failure in mechanics, never-halted PR (step is a no-op), missing
   sourceRef, and idempotent re-run (second finish pass changes nothing).
