# ADR: Post-rebase gate-first mechanical re-verify (build only)

**Date:** 2026-07-08
**Status:** APPROVED
**Amends:** `.docs/specs/2026-06-25-phase-9.0-rebase-on-latest.md` FR-5/FR-6 (invalidation
semantics unchanged; dispatch becomes conditional for `build`), `adr-001-rebase-insertion-mechanism.md`
**Driver:** jstoup111/ai-conductor#420 — every file-changing finish-time rebase re-dispatches a
full build agent (~45–60 min) before the mechanical completion gate, which would have confirmed
completion in ~1–2 minutes with zero LLM tokens.

## Decision

On a file-changing clean rebase (`outcome.kind === 'changed'`), `applyRebaseVerdicts`
(`src/conductor/src/engine/rebase.ts:725`) re-evaluates the **build** gate's mechanical
completion predicate against the freshly-rebased tree **before** writing its
`satisfied:false` kickback verdict:

- **Pre-verify passes** → build's objective verdict is recomputed fresh (`satisfied:true`,
  reason: re-verified mechanically after file-changing rebase) and build is **not** kicked back
  or reset to pending; a structured event (`rebase_gate_reverified`) records that dispatch was
  skipped. `advanceTail` resets only the actually-kicked-back steps.
- **Pre-verify fails or throws** → identical to today: `satisfied:false` +
  `kickback:{from:'rebase'}`, build agent re-dispatched (genuine pending work). Fail-closed.

**Scope of the pre-verify is exactly `build` — not `build_review`, not `manual_test`.**
Those gates remain unconditionally invalidated on a file-changing rebase, as today.

**Wiring:** `applyRebaseVerdicts` gains an optional pre-verify capability injected by the
caller (the conductor's `runRebaseStep`, which closes over `completionCtx`/`checkStepCompletion`
— `conductor.ts:1514-1558` post-step shape). `rebase.ts` takes no import dependency on
`artifacts.ts`. When the capability is absent (unit tests, any legacy caller), behavior is
byte-identical to today — absence fail-closes to unconditional invalidation.

## Why build qualifies and the others do not (verified 2026-07-08)

| Gate | Predicate basis | Attests the rebased tree? |
|---|---|---|
| `build` | `deriveCompletion` over git evidence trailers, `root-commit..HEAD`, re-derived on EVERY evaluation, never trusts task-status rows (`artifacts.ts:589-688`, `autoheal.ts:670-707`) | **Yes** — rebase preserves commit messages, so evidence trailers survive; the derive runs against post-rebase history (verified: anchor is the repo root commit, not a pre-rebase sha) |
| `build_review` | artifact-presence glob (`.pipeline/build-review.json`) | **No** — a pre-rebase verdict file passes on presence alone; the diff it graded just changed |
| `manual_test` | latest-attempt FAIL scan + session-freshness mtime + whitewash marker (`artifacts.ts:831-906`) | **No** — a pre-rebase results file from the same daemon session is "fresh" and would falsely confirm |

A gate is eligible for pre-verify **iff its predicate mechanically re-verifies the current
tree/history**. Today that set is `{build}`; a future gate whose predicate becomes
tree-attesting can be added by meeting that bar, not by listing it.

## Invariants preserved

- **Fail-closed:** "rebased tree ≠ approved tree → re-verify" still holds — the re-verify is
  the mechanical predicate itself, run first. No gate is ever confirmed without a fresh
  evaluation against the rebased tree. Any pre-verify error → invalidate (never skip on doubt).
- **Review-kickback rework is never swallowed:** the pre-verify exists ONLY inside the rebase
  invalidation path. Kickbacks with `from !== 'rebase'` (e.g. `build_review` requesting rework)
  never pass through it — a mechanical evidence pass must not cancel requested rework (the
  oscillation hazard: review fails → build skipped → review fails …).
- **No new control flow:** verdict files, selector, `advanceTail`, retry/anti-oscillation HALT
  machinery all unchanged. The only change is *which verdicts* the rebase path writes.

## Consequences

- The ~45–60-min build-agent lap on every file-changing finish rebase (the normal
  concurrent-merge condition) drops to a ~1–2-min mechanical derivation when all tasks remain
  evidence-complete. `build_review` and `manual_test` still re-run (minutes, and they are the
  gates that actually attest the changed tree at their level).
- `test/integration/rebase-loop.test.ts:285` (`expect(buildRuns).toBe(2)`) inverts to 1 for the
  evidence-intact case; a new case pins `buildRuns === 2` when evidence is genuinely missing
  post-rebase (e.g. a plan task with no trailer), and existing review-kickback tests pin the
  rework path unchanged.
- **Accepted safety delta (operator-approved):** today's redundant build dispatch incidentally
  re-ran the project test suite against the rebased tree; the mechanical confirm does not.
  A semantically-conflicting-but-cleanly-applying rebase whose breakage only a suite run would
  catch is now caught later — by `manual_test` (still re-runs, drives the app), by PR review, or
  by CI (the ship→CI kickback loop, spec landed as #421). Extending the pre-verify confirm with
  a deterministic suite run is explicitly noted as future hardening, out of scope here.

## Alternatives rejected

- **Generic pre-dispatch completion check at the step-loop top** (scoped to
  `kickback.from === 'rebase'`): centralizes the seam but touches the hot loop every step
  traversal and the scoping guard must be airtight or review rework gets swallowed. Rejected —
  see `.memory` decision 2026-07-08-post-rebase-gate-first-reverify.
- **Pre-verify all three candidate gates, "predicates decide":** falsified during review —
  `build_review`/`manual_test` predicates are not tree-attesting (table above) and would
  falsely confirm stale pre-rebase artifacts.
- **Verify-only re-dispatch prompt:** still burns an agent session; not zero-token.
