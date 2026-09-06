# Architecture Review: Bounded mechanical remediation in the self-host release gate

**Date:** 2026-09-06
**Mode:** lightweight (Medium tier) — Sections 2 and 4 only
**Source:** jstoup111/ai-conductor#658
**Input reviewed:** `.docs/track/ship-halts-on-model-table-drift-whose-failure-mess.md`,
`.docs/complexity/ship-halts-on-model-table-drift-whose-failure-mess.md`,
`.docs/architecture/ship-halts-on-model-table-drift-whose-failure-mess.md`
**Verdict:** APPROVED WITH CONDITIONS

## Scope boundary (binding, from the track marker)

A general, bounded mechanical-remediation lane in the self-host release gate. The integrity suite
declares a deterministic remediation per failed check; the engine executes it only when the command
is on an engine-side allowlist, commits, and re-runs the suite once before halting. Excluded:
edit-time prevention of drift, other sub-gates, repeated attempts.

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | No new dependency. Bash (`assert` helper in `test/test_harness_integrity.sh`), TypeScript in `src/conductor/src/engine/self-host/release-gate.ts`, `execa` for git, all already present. |
| Prerequisites | None outside the diff. The two initial remediation commands already exist and are exercised by integrity checks 5a and the docs-guard drift check. |
| Integration surface | Three surfaces: the suite's `assert` helper (backward-compatible optional third argument — verified: `assert()` takes `(desc, result)` today and ~174 call sites pass two args), `runIntegritySuite`/`runReleaseArtifactGate`, and the `ConductorEvent` union + `EVENT_SINKS`. No consumer-facing surface changes. |
| Data implications | None. No persisted schema; the remediation record is transient run output. |
| Performance risk | One extra full suite run (bounded by the existing `timeoutMs`) on the self-heal path only. |
| Worktree isolation | `conductor.ts` passes `projectRoot === harnessRoot === this.projectRoot`, which on a self-host build is the feature worktree (verified). Both remediation commands resolve their tool paths relative to their own script location (`bin/generate-model-table` uses `readlink -f "$0"`), so run from the worktree they read and write only the worktree. |

### Load-bearing claims

- *The gate's git commit lands in the worktree, never the live root checkout.* **Verified 92%** —
  `conductor.ts` gate call site; `.worktrees/` is live-boundary-excluded.
- *`bin/generate-docs-guard-hook` writes `hooks/claude/docs-guard.sh`, not `.docs/`.* **Verified** —
  `generate-docs-guard-hook.ts` writes `opts.outPath` set from the hook path; the phase-scoped
  docs-write guard (adr-2026-07-22) is therefore not engaged.
- *Engine-authored commits bypass the protected-artifact and plan-scope commit hooks via
  `CONDUCT_ENGINE_COMMIT=1`.* **Verified** — `git-hook-assets.ts` early-exits on that env; the
  committed-halt-record path (`halt-record.ts`) already commits with `--no-verify` at the ship tail.
- *A `mechanical` halt class would be auto-re-kicked.* **Verified** — adr-2026-07-28 retains auto
  re-kick for `mechanical`; hence the post-self-heal halt is `needs-human`.
- *Integrity checks 5a/5b warn-skip with exit 0 when `src/conductor/node_modules` is absent.*
  **Inferred 85%** from adr-2026-07-03-generated-model-table-single-source. Impact if wrong: none on
  the design — the lane keys only on failed checks, never on the suite's overall exit code.

## Alignment

**Governing ADR, amended rather than superseded.**
`adr-2026-06-30-halt-based-release-gates` states that a guardrail "that cannot self-satisfy …
never proceeds". A lane that mutates the tree and re-runs the gate is a gate that self-satisfies,
so the ADR now carries an additive amendment note (dated 2026-09-06, #658) adding a fourth
satisfying condition to the integrity-suite arm. The amendment follows the exact shape
adr-2026-07-06-migration-gate-waiver used for the migration arm: a validated extra condition
beside an unchanged fail-closed default. No new ADR is created: the structural decision (what the
release gate may accept) is owned by the existing ADR, and this repository prefers amendments over
new ADRs for minimal changes to a governing decision.

**Precedents applied (verified by reading each ADR):**
- adr-2026-07-23-session-hook-repair-before-halt — "repair, then re-check; do not demote". The lane
  is the same shape at a different halt.
- adr-2026-08-23-committed-halt-record — engine SHIP-tail commits are already sanctioned; the lane
  reuses that discipline (commit unconditional, nothing throws, failure reported as an event).
- adr-2026-07-13-retry-classify-rerun-vs-route — the "every failed check declared an allowlisted
  command" predicate is pure, deterministic, LLM-free, and decided before anything runs.
- adr-2026-07-05-retry-as-escalation-ladder §8 — the lane is a one-shot inside the gate and does
  not consume or extend any step retry budget.
- adr-2026-07-26-event-sink-registry-exhaustiveness and
  adr-2026-08-09-reseal-audit-rides-the-existing-event-spine — the self-heal outcomes are
  occurrences; extend the `ConductorEvent` union and declare each in `EVENT_SINKS`; no sidecar.

**Bounded departure, recorded here.** adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch
D3 says "the re-check reads; it never writes". That ADR governs the *dispatch-boundary* re-check of
tree-attesting gates. This lane lives inside `runReleaseArtifactGate` at the SHIP tail and is not
a member of the tree-attesting set; it is scoped out of that ADR rather than amended into it. The
departure is bounded: the only writes are the allowlisted commands' outputs plus one commit, in the
worktree, once.

**Domain boundaries / state.** The self-heal outcome is a closed enum
(`declined-undeclared | declined-not-allowlisted | attempted | succeeded | failed`), never a set of
booleans. The allowlist is a typed readonly array of exact command strings — no prefix, glob, or
argument matching. The remediation record parser rejects any record it cannot fully parse
(fail-closed, per adr-2026-07-06 W2).

**Diagram accuracy.** The feature diagram is authored and renders. The as-built finish-plane
diagram `.docs/architecture/2026-06-30-harness-self-host-guardrails.md` still shows
gate-fail → HALT unconditionally; refreshing it is a condition below.

**Focused local pattern basis.** The bounded-attempt bookkeeping should follow `build_review`'s
mechanical-fault lane: an explicit numeric allowance, a terminal verdict once exhausted, and the
exhausted reason naming the last fault. Rediscovery seeds: `MAX_MECHANICAL_FAULTS_BUILD_REVIEW`
in `build-review-cli.ts`; `mechanical-fault` envelope kind in `build-review-aggregate.ts`. Traits to
preserve: the allowance is a constant, exhaustion is reported with the cause, and the terminal
halt names what would have to change. Allowed variation: the allowance here is exactly one and is
per gate run, not persisted across runs.

## Wiring Surface

| New surface | Called from (design-time commitment) |
|---|---|
| `assert` optional third argument + machine-readable remediation record emission in `test/test_harness_integrity.sh` | The existing 5a model-table drift check and the docs-guard drift check pass their remediation command; the record is emitted on a dedicated stream/file the gate reads (exact channel decided in the plan). |
| Remediation-record parser + allowlist + self-heal orchestration in `src/conductor/src/engine/self-host/release-gate.ts` | Invoked by `runReleaseArtifactGate` on the integrity-failed branch, which is called from the conductor's SHIP tail (`this.guardrails.releaseGate(...)` in `conductor.ts`). |
| Engine remediation commit | Performed by the gate via the engine-commit env (`engine-commit-env.ts`) — same seam as the committed halt record. |
| `ConductorEvent` variants for self-heal outcomes | Emitted by the gate through the injected `ConductorEventEmitter`; persisted by `EventPersister` into `.pipeline/events.jsonl`; rendered by the terminal renderer per their `EVENT_SINKS` declaration. |
| Halt class on the post-self-heal HALT | Through the existing `writeSelfHostHalt` → `writeHaltMarker` with class `needs-human`. |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A build agent adds a self-declared "remediation" to make its own integrity failure vanish | Security | Medium | High | Allowlist is an engine constant; unknown command → HALT naming it. |
| The one-attempt bound is defeated by daemon re-kick | Technical | Medium | High | Post-self-heal HALT class is `needs-human`; a test asserts the class. |
| Remediation command needs `src/conductor/node_modules/.bin/tsx` that the worktree lacks | Integration | Low | Medium | Command exit non-zero → immediate HALT (never re-run the suite after a failed remediation). |
| Regenerated output differs from what the build agent intended (e.g. agent also edited metadata wrongly) | Data | Low | Low | The commit is in the PR diff the operator reviews; the halt/pass is reported on the spine. |
| Suite exit 0 read as "no failures" while checks warn-skipped | Technical | Low | Medium | Lane keys on declared-failed records only; exit 0 never enters the lane. |
| Engine commit mistaken for agent liveness (adr-2026-07-23-commit-movement-liveness-floor) | Technical | Low | Low | Commit occurs at the SHIP tail after BUILD completion; liveness floor applies to BUILD. |

## ADRs Created

None. `adr-2026-06-30-halt-based-release-gates` is amended (additive note, 2026-09-06, #658).

## Conditions

1. The post-self-heal HALT (and every declined path that reaches HALT) is written with halt
   class `needs-human`; a unit test asserts it.
2. The allowlist is an exact-string readonly constant in `release-gate.ts` containing only
   `bin/generate-model-table` and `bin/generate-docs-guard-hook`; adding an entry is a reviewed
   code change.
3. A remediation command that exits non-zero, or a commit that fails, HALTs immediately without
   re-running the suite.
4. Every new `ConductorEvent` variant carries an `EVENT_SINKS` declaration and is persisted
   (`persist: true`).
5. `.docs/architecture/2026-06-30-harness-self-host-guardrails.md` gains a change-log row and its
   finish-plane sequence shows the bounded remediation branch, in the same diff.
6. `docs/explanation/gates.md` (and the stalled-feature runbook, if it documents the integrity
   halt) describe the self-heal lane and its allowlist.
