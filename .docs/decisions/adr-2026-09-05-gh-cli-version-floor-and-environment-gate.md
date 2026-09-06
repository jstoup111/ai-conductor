# ADR: A declared `gh` version floor, enforced as a machine-level environment gate

**Date:** 2026-09-05
**Status:** APPROVED
**Deciders:** James Stoup (operator), architecture-review for jstoup111/ai-conductor#2139

## Context

The harness depends on the `gh` CLI for every ship path, and has never declared a minimum version.
On a machine running `gh` 2.14.1 (2022-07-12), every feature reaching FINISH halted indefinitely:
`shipment-evidence.ts:93` requests `gh pr view <pr> --json url,headRefOid`, that CLI answers
`Unknown JSON field: "headRefOid"`, and `finish-record-cli.ts:229` requires the field inside a
deliberately fail-closed block (`:206-208`). The error is indistinguishable at that call site from
"the PR does not exist", so the run reported `outcome_record_write_failed`, burned the full FINISH
retry budget, halted, and re-dispatched forever. Diagnosis required reading engine source and
testing the CLI field by hand; no log line, halt message, or runbook mentions a CLI version.

Two forces shape the response:

**This is an infrastructure failure, not a feature failure.** The machine is broken, not the work
being built. Today's behavior records a machine-wide defect against one feature's PR and charges it
that feature's retry budget — which is the deeper defect, independent of the wrong message.

**The corpus already governs both halves.** `adr-2026-07-22-canonical-tracker-client-seam` makes
`makeProductionGh()` the only production `gh` factory.
`adr-2026-07-22-daemon-level-missing-credential-gate` governs a globally-missing precondition: one
waiting condition that prevents dispatch, writing no per-feature HALT markers. No ADR in the
corpus declares any `gh` version floor (verified by exhaustive sweep of all 551 files in
`.docs/decisions/`, 2026-09-05).

## Evidence

Verified 2026-09-05 against the GitHub API by comparing merge commits with release tags
(`repos/cli/cli/compare/<tag>...<sha>`; `ahead` = not contained, `behind` = contained).

| Claim | Basis | Confidence |
|---|---|---|
| `headRefOid` on `gh pr view --json` first shipped in **v2.18.0** (2022-10-18). cli/cli#6399, commit `a493f6db`: `ahead` of v2.17.0, `behind` v2.18.0. | verified | 97% |
| `gh pr edit` against GitHub's sunset Projects (classic) GraphQL was fixed by cli/cli#10942 "Feature detect v1 projects on pr edit", commit `e5f7a453`: `ahead` of v2.72.0, `behind` **v2.73.0** (2025-05-19). | verified | 95% |
| That fix is the one that resolves the exact `repository.pullRequest.projectCards` error observed on 2.14.1. | inferred from the PR title and the error's GraphQL path | 90% |
| The harness issues `gh pr edit` in five production paths, two inside FINISH publication: `finish-publication-production.ts:106` and `:325`, `halt-pr-rehabilitation.ts:224` and `:802`, `engineer/release-metadata-inject.ts:115`. | verified by grep | 99% |
| `gh --version` prints a parseable `gh version X.Y.Z (...)` first line across the relevant range. | unverified | — |

The last row is load-bearing for the parser and is the reason Decision 7 requires a real-binary
smoke before this lands, per `adr-2026-07-07-daemon-owned-build-credential` decision 5.

## Options Considered

### Option A: Per-field capability probe (the intake's hypothesis)
Enumerate the `--json` fields the harness depends on and probe them against a live PR.
- **Pros:** self-describing; tolerates an old-but-sufficient CLI.
- **Cons:** needs an existing PR to probe against, so it cannot run on a fresh repo — exactly when
  a first-run operator needs it; detects no non-JSON breakage, so it would have missed the
  `gh pr edit` failure entirely; its field registry is a second artifact to keep in sync with the
  25 modules that request `--json` fields. `adr-2026-07-27-codex-never-resumes-a-harness-minted-session`
  already establishes the corpus's capability model as a declared boolean on a contract rather than
  a discovered per-field registry.

### Option B: Translate the error at the seam and stop there
Wrap `makeProductionGh()` so `Unknown JSON field` becomes an accurate message.
- **Pros:** smallest possible diff; every call site benefits.
- **Cons:** the operator still learns only at FINISH, after the retry budget is spent. It fixes the
  message and leaves the infrastructure failure charged to the feature.

### Option C: Declared version floor, refuse to start
A single floor constant checked at process start; below it, the daemon exits.
- **Pros:** loud and simple.
- **Cons:** no precedent and four counter-precedents (`adr-2026-07-20-ci-fix-startup-preflight`
  disables ci-fix for the run; `adr-2026-07-29-codex-readiness-probe-failure-disposition` proceeds
  on probe failure; `adr-2026-07-04-auth-failure-park-and-poll` D4 fails open;
  `adr-2026-07-22-daemon-level-missing-credential-gate` prevents dispatch rather than exiting).
  It also cannot express a `gh` that changes under a running daemon, and kills in-flight state.

### Option D (selected): Declared version floor, enforced as a machine-level environment gate
The floor is a constant; a machine below it produces one waiting condition that prevents dispatch;
the seam separately produces a typed capability error for anything that slips through.

## Decision

1. **Declare a minimum supported `gh` version of v2.73.0.** The floor is set by the strictest
   requirement the harness actually has, not by the field that happened to be noticed. `headRefOid`
   needs v2.18.0, but five production paths call `gh pr edit` — two of them inside FINISH
   publication — and that only works from v2.73.0. A v2.18.0 floor would leave those two FINISH
   call sites broken across a 55-release window.

2. **The floor is a code constant, not a `settings.json` key.** Following
   `adr-2026-08-06-bounded-progress-allowance-for-finish-publication`: "constants rather than
   `settings.json` keys… a correctness backstop, not a tuning knob." A floor an operator can lower
   in the field is not a floor. This deliberately declines the
   `adr-2026-07-29-codex-readiness-probe-failure-disposition` D4 reading ("no private runtime
   constant owns production behavior"), which applies to a *timeout* — a legitimate tuning knob —
   not to a correctness precondition. Consequently no consumer-registry entry
   (`adr-2026-08-26` D4) and no `## Migration` block are owed.

3. **A machine below the floor prevents dispatch and is never recorded against a feature.** The
   gate reuses the shape of `adr-2026-07-22-daemon-level-missing-credential-gate`: one waiting
   condition, no per-feature HALT markers, no feature claimed, no retry budget spent. An old `gh`
   is a property of the machine; charging it to a feature is the root defect in #2139, not merely
   its symptom. This also composes with — rather than duplicating —
   `adr-2026-08-03-fail-closed-decide-entry` at the DECIDE/engineer entry point.

4. **The version probe is injectable and calls `assertRealExecAllowed`.** `AI_CONDUCTOR_NO_REAL_EXEC`
   is set globally by the test setup, and both `runDaemonMode` and `dispatchEngineer` boot under
   test. A raw `execFile('gh', ['--version'])` at either entry point would make every such test
   shell out. The probe therefore takes an injected runner and guards it like every other
   production factory, per `adr-2026-07-22-canonical-tracker-client-seam`.

5. **`gh`'s unsupported-field error becomes a typed error class at the seam boundary, and nothing
   downstream branches on its text.** `makeProductionGh()` gains a thin wrapper producing a typed
   capability error naming the CLI and the field. Matching `Unknown JSON field` is permitted only
   at that boundary, to *produce* the class. Per `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane`
   D1 — "route on result kind, never on reason text" — no consumer may match the message.

6. **Each caller keeps its existing disposition; the wrapper changes only the error's type and
   text.** The seam serves callers with deliberately opposite policies:
   `finish-record-cli.ts` is fail-closed zero-write (`adr-2026-07-07-finish-record-primitive` D3)
   and the finish completion gate is fail-open on read errors
   (`adr-2026-07-03-halt-pr-rehabilitation-at-finish` D3, which explicitly rejected fail-closed
   there). A single blanket policy would contradict one of them. No caller's disposition changes.

7. **Any HALT this path writes is `needs-human`, never `mechanical`.** `halt-marker.ts:35` defines
   `mechanical` as marks "the daemon may safely re-kick"; a re-kick meets the identical CLI. An
   infrastructure failure is not necessarily a transient one. This follows
   `adr-2026-07-28-total-halt-classification-legacy-boundary`'s rule that a writer which cannot
   mechanically prove retry safety uses `needs-human`.

8. **A real-binary smoke gates the version claims before this lands.** Per
   `adr-2026-07-07-daemon-owned-build-credential` decision 5, a claim about installed-CLI behavior
   requires a real-binary smoke. The `gh --version` output shape is the one unverified assumption
   in the Evidence table, and the parser rests on it.

9. **The residual seam gap is recorded, not closed.** `worktree.ts:186` calls
   `execFile('gh', …)` directly, outside `makeProductionGh()`, so the Decision 5 translation does
   not cover it. It requests only `state`, present in every `gh` in circulation, so closing it is
   out of scope. It is recorded here because
   `adr-2026-07-22-canonical-tracker-client-seam` claims `makeProductionGh()` is the only
   production `gh` factory, and that claim is not currently exact.

10. **`park-reconciliation.ts:283` is recorded as a second `headRefOid` consumer.** It holds
    branch- and worktree-deletion authority under
    `adr-2026-08-01-multi-proof-park-deletion-authority` D1. Below the floor it degrades to
    inaction with a refusal cause that misstates why. This ADR adds no proof to that ADR's set and
    does not amend it; the floor makes its existing proof reliable.

## Consequences

### Positive
- A machine-wide environment defect is diagnosed in seconds at the gate rather than after a feature
  burns its retry budget, and is never attributed to the feature.
- One number covers both the JSON-field class and the non-JSON `gh pr edit` class; a per-field
  registry would have covered only the first.
- The two `gh pr edit` call sites inside FINISH publication become safe by construction, as do the
  three outside it, and `park-reconciliation`'s deletion authority becomes reliable.
- `pr-labels.ts:62-71` and `pr-criticality-labels.ts:68-74` — which already route around the
  Projects-classic breakage to raw REST — stop being load-bearing workarounds, though they remain
  correct and are not touched here.

### Negative
- Operators on `gh` below v2.73.0 must upgrade before the harness will dispatch, including those
  whose usage would have worked. This is accepted: a fast, named refusal is strictly better than
  the indefinite silent halt it replaces, and the remedy is one command.
- The floor must be raised by hand when the harness adopts a field or command newer than v2.73.0.
  No machinery detects that; a stale floor degrades to today's behavior for the new dependency.
- The repository carries 312 unmerged spec branches, and 46-91% of them touch each file in this
  feature's surface, so even a thin wrapper carries real rebase cost. This argues for a minimal
  diff, not against the change.
- v2.73.0 is a May 2025 release, which is a hard requirement for anyone on a distribution with a
  slow `gh` package.

### Follow-up Actions
- [ ] Real-binary smoke covering `gh --version` parsing (Decision 8), before this lands.
- [ ] State the floor in `README.md` and the five `docs/` prerequisite tables.
- [ ] Consider machinery that derives the floor from the fields and commands the source actually
      uses, so it cannot go stale — not in this feature's scope.
- [ ] Close the `worktree.ts:186` seam bypass (Decision 9) — separate feature.
