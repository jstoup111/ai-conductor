# Conflict Check: Daemon log lines are readable to operators (#2867, covers #2367)

**Date:** 2026-10-09
**Stories:** .docs/stories/daemon-log-lines-are-unreadable-to-operators.md (Stories 1-8)
**ADR corpus:** repo_wide (`.ai-conductor/config.yml` `conflict_check.adr_corpus`)
**Result:** PASS after resolution — 4 blocking resolved (3 by correcting prior-feature stories in place in DECIDE, 1 by changing this spec's design); 0 blocking remaining; 0 degrading accepted. Two cross-spec coordination notes recorded.

## Corpus

- **ADRs:** about 339 `adr-*.md` files grepped for daemon-log requirements (`daemon.log`, `daemon log`, `renderDaemonEvent`, `log line`, `logged`, `daemon_verbose`, `attempt identity`, `trace`, `route:`, `byte-exact`) by a delegated sweep; about 25 read closely. Narrowed in: kickback-event-emission-and-log-prominence, provider-preparation-lifecycle-supervision, setup-failure-triage, mixed-build-review-laps-preserve-content-adjudication, daemon-session-command-contracts, event-sink-registry-exhaustiveness, observed-close-watch-registry, cold-start-within-step-retries, codex-never-resumes-a-harness-minted-session, intra-step-build-progress-events, reactive-model-fallback-ladder, pr-timing-self-host-precedence, shared-coherence-parser-at-discovery, defer-feature-worktree-reap, operator-park-marker, build-settle-outcome-stamp, finish-human-required-halt-rendering. All others narrowed out as not stating daemon-log output.
- **Skipped as unambiguously fully superseded:** adr-2026-08-29-build-review-remediate-case-adjudication, adr-2026-08-16-preservation-anchored-completeness-exemption, adr-2026-08-15-verify-only-anchored-tautology-exemption, adr-2026-08-29-operator-authorized-kickback-budget-recovery.
- **Stories:** about 553 files grepped; about 45 read closely in their relevant blocks.
- **Open spec PRs / issues:** #2879 (log export), #2368 (dispatch slot identity).

## Conflict: Boundary-fingerprint line required for every fingerprint event

**Stories involved:** Story 5 vs generated-project-artifacts-delay-provider-startup Story 2
**Files:** [.docs/stories/daemon-log-lines-are-unreadable-to-operators.md] vs [.docs/stories/generated-project-artifacts-delay-provider-startup.md]
**Type:** contradiction
**Severity:** blocking

**Description:** The prior story required one daemon-log line for each emitted `self_host_boundary_fingerprint` event. Story 5 renders only the first fingerprint of a dispatch at default verbosity.

**Resolution Options:**
1. Correct the prior story so the per-event line is guaranteed for the first fingerprint of a dispatch and for every fingerprint under `daemon_verbose: true`; the event ledger still records every event.
2. Keep every fingerprint line at default and drop fingerprint timings from Story 5.

**Recommendation / applied:** Option 1. #2867 names fingerprint timings explicitly as per-step boilerplate, and the diagnostic purpose (attributing a slow pre-provider stall) is preserved by `.pipeline/events.jsonl` and the verbose log. Applied in place in DECIDE (commit `spec: amend fingerprint and provider-lifecycle stories …`).

## Conflict: Provider lifecycle phases and attempt identity required in the default log

**Stories involved:** Stories 3 and 5 vs daemon-build-review-can-wedge-before-provider-laun Story TI-1
**Files:** [.docs/stories/daemon-log-lines-are-unreadable-to-operators.md] vs [.docs/stories/daemon-build-review-can-wedge-before-provider-laun.md]
**Type:** contradiction
**Severity:** blocking

**Description:** TI-1 required "status and logs" to identify `preparing` and `running` with an attempt identity, and its Done When required durable daemon output to name the attempt identity. Story 5 makes routine lifecycle phases verbose-only, and Story 3 removes UUID attempt ids from the default log.

**Resolution Options:**
1. Correct TI-1 so status always distinguishes the phases with attempt identity and the daemon log does so under `daemon_verbose: true`, while `recovering` and terminal halt stay in the default log by step and recovery count.
2. Exempt provider lifecycle lines from Stories 3 and 5.

**Recommendation / applied:** Option 1. #2867 names provider lifecycle triples and bare UUIDs explicitly; the wedge diagnosis TI-1 protects is preserved by `daemon status`, the default `recovering` and halt lines, and the verbose log. Applied in place in DECIDE (same commit). `adr-2026-07-30-provider-preparation-lifecycle-supervision` is not amended: its decisions are unchanged, and its consequence "status and logs distinguish … with attempt identity" still holds through status and the verbose log.

## Conflict: Base-advance sweep must log the retained disposition itself

**Stories involved:** Story 4 vs a-halted-feature-only-re-runs-when-a-human-clears- Story 3
**Files:** [.docs/stories/daemon-log-lines-are-unreadable-to-operators.md] vs [.docs/stories/a-halted-feature-only-re-runs-when-a-human-clears-.md]
**Type:** contradiction
**Severity:** blocking

**Description:** The prior criterion said the base-advance re-kick sweep "logs the retained disposition". Story 4 negative 4 logs a retained feature once across all three retention checks, so the sweep may not log it when another check already has.

**Resolution Options:**
1. Correct the prior criterion to "the daemon log carries the retained disposition", logged once per disposition change across the retention checks.
2. Give each retention check its own memory (three lines per change).

**Recommendation / applied:** Option 1; one line per state change is the #2867 outcome. Applied in place in DECIDE (commit `spec: amend retained-disposition logging criterion …`).

## Conflict: Daemon-composed multi-line output required in the log

**Stories involved:** Story 6 vs adr-2026-07-09-setup-failure-triage D5, setup-before-dispatch-wedge-deterministic-setup-fa, and daemon-build-agents-leak-edits-into-the-main-check
**Files:** [.docs/stories/daemon-log-lines-are-unreadable-to-operators.md] vs [.docs/decisions/adr-2026-07-09-setup-failure-triage.md]
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** adr-2026-07-09-setup-failure-triage
**Story ID:** Story 6
**ADR opposing sentence (verbatim):** "the quarantine ref and setup stderr tail are named in the daemon log and in any resulting HALT"
**Story opposing sentence (verbatim, as first drafted):** "Given a multi-line message logged by a daemon-wide site that has no feature tag, when it is logged to the default log, then it is collapsed to one line in the same way as a feature-owned message."

**Description:** As first drafted, Story 6 collapsed every multi-line log message at default verbosity. The setup-failure ADR requires the setup output tail in the daemon log. The leak-suspect story requires a per-file explanation table in its WARN.

**Resolution Options:**
1. Narrow Story 6 to *forwarded* text (event payload text and provider diagnostic output), which is where #2867's evidence comes from (the test-suite output inside `step_failed.error`, agent text inside halt reasons, provider JSON). Keep multi-line text the daemon composes itself whole, with `│ ` continuations so #2367's indentation rule still holds.
2. Supersede the ADR decision.

**Recommendation / applied:** Option 1, a change to this spec's own stories and design (Story 6 terms, a new Story 6 negative path, and the Task 2 logger kinds). No prior artifact changes.

## Resolved by design (no prior artifact changed)

- **adr-2026-07-04-kickback-event-emission-and-log-prominence D1** fixes the form `↩ KICKBACK: <from> re-opened <to> — <evidence> (×<count>)`. A kickback is info severity at depth 0 in this spec, with no next-action suffix (the daemon re-runs the target automatically), so the form is byte-preserved. Multi-line evidence is collapsed after its first line, which keeps the ADR's shape.
- **make-every-gate-verdict-recoverable-from-the-event Story 2** ("the existing unsatisfied line is unchanged"): `gate_verdict` is info severity in both forms and keeps its text (Task 8).
- **operator-configurable-confidence-floor-for-acting- Story 7** ("when the trace for the lap is rendered, then each settled case appears with its finalized outcome"): the coordinator still renders the trace string. Only the conductor's raw daemon-log write of it is removed. Each settled case appears with its outcome in the verbose final-verdict detail lines, and `remediation_adjudication_completed` still renders, satisfying adr-2026-08-29-mixed-build-review-laps D5.3 ("a completed adjudication rather than an absence").
- **halt-pr-reconciliation-sweep-logs-on-delta-only-52 Story 3** (the `healed` / `heal unconfirmed` / `error healing` lines keep their wording): Task 20 touches only the `failed to enumerate PRs` and `sweep error` lines. A multi-line `<err>` in a raw daemon-composed line stays whole.
- **daemon-halt-reconciliation** (identical startup dashboard to stdout and `daemon.log`): it is daemon-composed and kept whole.
- **2026-07-22-daemon-suppress-other-owner-log-noise** ("exactly one wiring site" for `gatedWritebackDeps.verbose`): that wiring site is unchanged. This spec reads `daemon_verbose` for different dependencies.
- **engine-prompts-direct-daemon-sessions-to-ai-conduc Story 7** ("daemon rendering with correct identities"): feature and subcommand attribution stay at default; event and dispatch ids remain in the event record and the verbose log.
- **retain-protected-artifact-halts-across-base-advanc** ("every sweep reports the feature skipped"): the skip *reports* returned by the sweep are unchanged; only the log line is once per state change, and it still names the feature and disposition.
- **adr-2026-07-10-observed-close-watch-registry**: observation signatures match rendered lines. A signature that matched a now-verbose-only or UUID-bearing line would need re-pointing when such an observation is next authored. No current signature depends on the changed lines (the delegated sweep found none).

## Cross-spec coordination notes (not conflicts on main)

- **#2879 Harness log export (open spec PR).** Its Story 6 requires local daemon output to be identical with export on or off. This spec changes local output identically in both states, so the two are compatible. Its Story 5 requires two identical occurrences to export as two records. This spec's once-per-dispatch, retention and collapse rules are local presentation only and make no claim about what an export tap receives. If #2879 lands second, its tap must sit on the event spine or before this presentation filter to keep its own Story 5.
- **#2368 dispatch slot identity (issue).** This spec does not change the `[daemon][<tag>]` prefix; its depth rule is measured after the prefix, so a future slot identity in the prefix is unaffected.

## Story-vs-story within this spec

All pairs sharing a subject were checked in both directions:
- Story 3 against Story 5 (verbose identifiers);
- Story 6 against Story 8 (the `│ ` marker);
- Story 1 against Story 7 (the provisional line's no-action suffix);
- Story 4 against Story 7 (retention next action).

No contradiction or oscillation was found.
