# ADR: The release smoke gate goes live without pre-characterizing every previously-ungated file

**Date:** 2026-08-07
**Status:** APPROVED (operator-approved 2026-08-07)
**Deciders:** James Stoup (operator), engineer session (ai-conductor#1259)
**Feature:** no-release-time-smoke-or-eval-gate-releases-cut-wi (jstoup111/ai-conductor#1259)
**Supersedes:** adr-2026-08-04-smoke-capability-declaration-and-single-entry-point
**Related:** adr-2026-08-04-classify-before-spend-release-smoke-gate (the gate that consumes this
runner); adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate (the workflow it runs in)

## Context

The superseded ADR established the capability-declaration model and the single auto-discovering
entry point for the smoke tier. That decision stands unchanged and is restated in full below —
this ADR exists to reverse exactly one clause of it.

That clause, in Consequences → Negative, made the gate's go-live conditional:

> The three files that are currently ungated will begin running under `npm run smoke`, which may
> surface pre-existing failures that the exclusion glob has been hiding — those must be fixed or
> explicitly quarantined **before the gate can go live**, since the gate is fail-closed.

Condition **C-2** of the APPROVED design-time review
(`architecture-review-2026-08-04-no-release-time-smoke-or-eval-gate-releases-cut-wi.md`) carries
the same requirement and names the three files: `finish-record`, `publish-interrupted`,
`surgical-finish-retry`.

As built, that precondition is two-thirds discharged and one-third not
(`.docs/audit/no-release-time-smoke-or-eval-gate-task-14.md`):

- `finish-record.smoke.test.ts` — failed, fixed, then passed with 2 assertions. Discharged.
- `surgical-finish-retry.smoke.test.ts` — passed with 2 assertions. Discharged.
- `publish-interrupted.smoke.test.ts` — failed on `git worktree add` against a read-only shared
  refs directory, in one local invocation. It was neither fixed nor quarantined; it was
  force-skipped for that run via a command-line `SMOKE_FORCE_SKIP` that exists nowhere in the
  shipped tree.

`publish-interrupted` is classified `toolchain` requiring `bin/setup`, which exists in the CI
checkout — so in gate mode the file **executes**, performing a real `git worktree add` and running
the real `bin/setup` under a 600 s timeout against an `actions/checkout@v4` shallow clone in a job
with `permissions: contents: read`. That code path has succeeded zero times, in CI or locally.

The as-built architecture review BLOCKED on this and offered three resolutions: characterize the
file in CI first, quarantine it in the tree, or supersede the ADR. The operator chose to supersede.

## Decision

**The gate goes live now. `publish-interrupted.smoke.test.ts` is not pre-characterized, and its
first real execution may be the release gate itself.** The clause requiring every previously-ungated
file be fixed or explicitly quarantined before go-live is withdrawn.

The rest of the superseded decision is carried forward verbatim in intent:

- **Each smoke file declares the capability it requires, co-located with the test**, from the closed
  enum `hermetic` / `toolchain` / `credentialed`. A shared helper resolves availability once.
- **Advisory mode (default, local):** an unmet capability is a **skip**, recorded with the specific
  capability that was missing.
- **Gate mode (release):** an unmet capability is a **failure**, so a release whose smoke tier lacks
  credentials reports that explicitly instead of passing an empty run.
- **One entry point, discovery by glob.** `npm run smoke` runs `vitest.smoke.config.ts`, whose
  `include` globs are exactly the default config's `exclude` globs, with `exclude: []`. That empty
  exclude is deliberate and must not be "fixed" into a merge of the default config — Vitest merges
  `exclude` additively, which would re-exclude every file the config exists to select.
- **`vitest.config.ts` is not touched.** The gate is additive, so
  `test/structural/test-execution-policy.test.ts` keeps passing and `npm test` keeps its isolation
  guarantee.
- **The run emits a per-file ledger** — ran / skipped / failed, naming the unmet capability on a
  skip and the evidence path on a failure.

**Condition C-2 is discharged by this decision, not by evidence.** Its two discharged files remain
discharged on evidence; for `publish-interrupted` the condition is withdrawn on the same grounds as
the ADR clause it mirrors.

**Condition C-1 is unaffected and remains a merge prerequisite.** `CLAUDE_CODE_OAUTH_TOKEN` must
exist as an Actions secret before this feature merges. Gate mode fails closed on its absence and
names the secret, but the release is still blocked until it is provisioned.

## Rationale

The accepted cost is bounded and recoverable. If `publish-interrupted` fails in the gate, the
smoke job's conclusion is not `success` and `release.yml` blocks publish; per
`adr-2026-08-04-classify-before-spend`, no tag and no GitHub Release are created. Nothing is
half-published and nothing must be unwound — the release is deferred, not corrupted. The recovery
is the same work the alternatives would have front-loaded: fix the file, or quarantine it, and
re-run.

Against that, pre-characterizing it now costs a manual `live-daemon-e2e.yml` dispatch and a
re-run of the as-built gate on a feature that is otherwise complete, and it characterizes the
file only against today's runner — a later change to `bin/setup` or the checkout shape can
invalidate the evidence without invalidating the discharge. Choosing to learn the answer at the
first release trades a certain small delay now for a possible larger one later, and the operator
judges that trade acceptable.

This is a deliberate, recorded acceptance of the Risk Register's "previously-ungated smoke files
fail once actually run" row (Likelihood Medium / Impact High), not an oversight.

## Alternatives considered

- **Characterize `publish-interrupted` in CI first** (advisory `live-daemon-e2e.yml` dispatch,
  attach the run link as C-2 evidence, re-run the as-built gate). Rejected as described above:
  cheapest in tokens, but it delays a complete feature and yields evidence with a short shelf life.
- **Quarantine it in the shipped tree** (a `fetch-depth: 0` checkout plus a recorded
  `SMOKE_FORCE_SKIP` default, or reclassifying the file so gate mode does not execute it).
  Rejected: a persisted skip over a file whose actual state is unknown hides the very signal the
  tier exists to produce, and the plan's Amendment 3 forbids force-skipping to paper over a defect.
  Since it is not established whether the local failure was an environment limitation or a real
  `bin/setup` defect, quarantining would be making that call without evidence.
- **Leave the ADR clause in place and downgrade it informally.** Rejected: an APPROVED ADR's
  preconditions are not negotiable in place. Reversing one requires a new approved decision, which
  is this document.

## Consequences

**Positive.** The feature ships complete now. The acceptance is explicit and auditable rather than
implicit in a shell-history force-skip, so a future reader sees a decision instead of a gap.

**Negative.** The first release cut after this merges may block on
`publish-interrupted.smoke.test.ts` failing inside a paid, credentialed CI job, requiring someone
to debug a never-before-executed test at release time. `SMOKE_FORCE_SKIP` is the documented escape
hatch for that moment; using it to unblock a release still requires deciding whether the failure is
an environment limitation or a defect, and recording which.

**Follow-up (non-blocking).** The first observed gate-mode ledger line for
`test/smoke/publish-interrupted.smoke.test.ts` should be attached to this ADR as the evidence that
closes the question either way.
