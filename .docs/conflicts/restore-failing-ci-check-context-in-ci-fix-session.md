# Conflict Check: Reliable CI repair dispatch

Result: PASS

Source: jstoup111/ai-conductor#2153

Blocking conflicts remaining: 0

Degrading conflicts remaining: 0

Resolved conflicts: 2, under the operator-approved architecture and story corrections.

## Corpus and method

`conflict_check.adr_corpus` is `repo_wide` in this worktree. The corpus inventory read 485 story files, 54 specification files, 577 decision/review files, and 261 prior conflict reports. Repository-wide relevance scanning selected 35 story files, 10 specifications, and 38 historical conflict reports for classification; focused passage review covered the CI-repair, provider-policy/readiness, watch-state, worktree, verification, and event-authority intersections below. This is a complete inventory and relevance scan followed by scoped semantic comparisons, not a claim to have performed a full-text pairwise review of every unrelated historical feature.

All six new stories were compared in both directions for contradiction, incompatible overlap, ambiguous state, resource contention, sequencing, and oscillation. Applicable approved ADRs were compared against the affected stories. The appended ADR disposition inventory identifies every approved ADR as examined or narrowed out. An unrelated title or subject was narrowed out; a partial or ambiguous supersession was not grounds for exclusion. Historical fully superseded decisions were not used to overrule the current provider/session contract.

## Resolved conflict 1: Claude-only startup requirement versus build inheritance

**Type:** contradiction
**Original severity:** blocking
**Stories:** existing CF-5 versus new Story 3
**Files:** `.docs/stories/ci-fix-resolver-autofix.md` and `.docs/stories/restore-failing-ci-check-context-in-ci-fix-session.md`

**Prior opposing text:** CF-5 required a daemon host where “the `claude` fix-invocation surface is valid” and a probe “exactly once” at startup. New Story 3 requires: “Given a working Codex-only or Claude-only build configuration, when CI repair runs, then it uses that provider and the effective build model and effort; Codex-only repair does not depend on a Claude executable being installed.”

**Reasoning:** A Codex-only machine without Claude cannot satisfy both. Satisfying the old prerequisite would exclude a valid configured provider; satisfying the new story would intentionally bypass that prerequisite. This is the reviewed provider-readiness contradiction, not a newly discovered requirement.

**Resolution selected by the operator:** inherit build configuration, followed by explicit architecture approval and approval of the story review copy's prior-story corrections. CF-1's prerequisite and CF-5 are replaced in place with build-provider inheritance. The older startup-preflight ADR carries an additive clarification beside decision 1, referring to the later governing shared provider/readiness decisions. No independent provider routing or startup probe is introduced.

**Re-check:** PASS, 99% confidence, verified from the amended ADR and both accepted story files. Either built-in provider may run under the same configured build policy; neither requires the other's executable.

## Resolved conflict 2: Startup failure always disables versus explicit no-start accounting

**Type:** state conflict / incompatible overlap
**Original severity:** blocking
**Stories:** existing CF-6 versus new Stories 3 and 4
**Files:** the same existing and new story artifacts above

**Prior opposing text:** CF-6 required “ci-fix is disabled for the run” when its startup probe failed. New Story 3 requires an inconclusive Codex readiness result to permit the actual invocation under the existing policy; Story 4 requires affirmative no-start evidence before refunding a reserved repair attempt.

**Reasoning:** A single failed generic probe cannot mean both “disable repair for this run” and “allow the configured provider to settle the result.” Nor can a disabled-dispatch no-op be treated as a used repair opportunity. The result must distinguish affirmative prevention, inconclusive diagnostic failure, and actual execution. This does not permit auth-triggered provider fallback.

**Resolution selected by the operator:** replace CF-6 with provider-owned no-start refusal, explicit diagnostics, and restored attempt/cooldown values only when no start is proven; preserve classified failures and normal daemon operation. Update the corresponding acceptance-signals bullet. Stories contain the replacement behavior directly, without amendment records.

**Re-check:** PASS, 99% confidence, verified from the corrected CF-6, new Stories 3–4, and the approved Codex readiness contract. Probe-failed may proceed; affirmative refusal is explicit; ambiguous or actually attempted repair remains charged.

## New-story pair analysis

Each row evaluates both “satisfy A, does B hold?” and “satisfy B, does A hold?” The answer is yes for every row for the stated reason.

| Pair | Relationship and compatibility basis |
|---|---|
| 1 ↔ 2 | Required check identity is retained when optional logs fail; bounded omissions are explicitly marked, not disguised as complete context. |
| 1 ↔ 3 | Context preparation supplies data; build policy independently selects the provider. A missing context result never authorizes a blind invocation. |
| 1 ↔ 4 | Missing/unreadable context proves preparation did not start repair and leaves attempts unchanged; a started repair remains charged. |
| 1 ↔ 5 | Correct input is necessary but not sufficient for verified publication; guards/verifier/push remain required. |
| 1 ↔ 6 | Context errors retain explicit control results while the diagnostic is persisted; sink failure does not turn unknown context into success. |
| 2 ↔ 3 | Log degradation does not alter provider choice or readiness; provider fallback does not erase available context. |
| 2 ↔ 4 | Optional-log failure with usable identity can proceed and consume one actual repair; it is not a no-start refund signal. |
| 2 ↔ 5 | Bounded enrichment does not bypass post-repair verification or publication authority. |
| 2 ↔ 6 | Truncation and degradation remain visible but observational; raw sensitive payloads are not required for useful logs. |
| 3 ↔ 4 | Multiple allowed candidates remain one CI repair; no-start is aggregated as control evidence, not inferred from the last candidate or telemetry. |
| 3 ↔ 5 | Provider failure/noop cannot be converted to publication success; provider-native execution still returns to daemon verification. |
| 3 ↔ 6 | Provider/reason attribution preserves existing failure precedence; a diagnostic never authorizes fallback. |
| 4 ↔ 5 | Local verified publication retains its consumed attempt; only a later remote-green observation resets it. No success/reset oscillation remains. |
| 4 ↔ 6 | Exact persisted accounting is independent of delivery of the diagnostic; neither missing events nor log text authorizes refunds. |
| 5 ↔ 6 | Each refused stage yields a truthful failure result and diagnostic; a rendered success line cannot substitute for a successful push. |

## Existing story and specification comparisons

| Existing artifact / concern | New stories | Two-direction result |
|---|---|---|
| `ship-ci-feedback-loop`: bounded dispatch, counters, remote-green reset, exhaustion | 4–5 | Compatible: reservation remains before git work; explicit proven no-start reconciliation does not erase attempted/unknown work; cap remains two; no reset on local publication. |
| `ship-ci-feedback-loop`: read-error sentinel and label lifecycle | 1, 6 | Compatible: retrieval failure still authorizes no CI repair/label action; the new diagnostic is an additive observation rather than a fake failed-check classification. |
| `ci-fix-resolver-autofix`: CF-1–CF-7 | 1, 3–5 | Compatible after the accepted CF-1/5/6 corrections. No-change, classified failure, daemon verification, and unrelated-CI-cause exclusions remain. |
| `treat-completed-commit-status-entries-as-terminal-` (#2164) | 1, 4 | Compatible: completed statuses do not block an otherwise eligible PR; pending entries still prevent dispatch. The global merge/readiness classifiers are not redesigned. |
| `per-step-provider-routing-927` and its PRD | 3–4 | Compatible: run-level inheritance, explicit build preference, native settings, allowed unavailable-provider fallback, fresh sessions, and auth/ordinary failure precedence remain shared policy. |
| `daemon-merged-config-967` | 3 | Compatible: inheritance uses the existing effective merged daemon configuration; no new override layer or independent repair setting is introduced. |
| `model-attribution-and-provider-defaults-931`, `model-availability-fallback-ladder`, `support-astra-in-the-daemon` | 3–4 | Compatible: native provider/model resolution and attribution remain intact; no model alias translation or extra attempt per candidate is added. |
| Codex #905/#970/#1039 stories and PRDs; auth-park decomposition | 3–4, 6 | Compatible: affirmative credential facts remain distinct from probe failure; provider/auth-source fallback is not granted; no-start CI-repair accounting does not reset lifecycle/auth recovery budgets. |
| Built-in installation readiness #901 and first-class Codex parity #904 | 3 | Compatible: installation and adapter capabilities remain their own contracts; repair no longer imposes an extra Claude-only prerequisite. |
| `full-suite-verification-gate-940` Story 9 and its PRD FR-17 | 5 | Compatible: a new committed repair still receives its post-mutation configured verification; stale reusable evidence cannot suppress it. |
| `daemon-reaps-a-feature-worktree-at-pr-open-before-` Story S6 | 5 | Compatible: transient repair worktree and retained feature worktree keep distinct owners; this feature changes outcome handling, not retention/reap authority. |
| `auto-opened-needs-remediation-pr-occupies-the-bran-` and draft/halt PR stories | 4 | Compatible: draft and sticky-remediation suppression remain; repair never opens a second PR, clears a halt, or marks a draft ready. |
| `build-review-ci-watch-partial-block-1002` cooldown criteria | 4 | Compatible: existing configured cooldown remains authoritative; a proven no-start restores the prior timestamp rather than starting a repair cooldown. |
| Provider timing/telemetry dimension stories and durable-time PRD | 4, 6 | Compatible: timing/usage/events remain observations; new control results do not reinterpret missing telemetry as an unstarted repair. |
| `bin-setup-quarantines-a-fix-session-s-repair-inste-`, remediation closure, finish machinery | 5 | Narrowed by owner: their separate repair/finish flows are unchanged; no CI-repair outcome or guard change is exported as a replacement for those flows. |
| Memory, rubric policy, inventory, and unrelated instruction/fixture matches | all | Narrowed out after relevance classification: they mention providers/repair but own no changed CI-repair state, check input, or result authority. |

## ADR-versus-story analysis

| Examined governing subject | Stories | Result |
|---|---|---|
| CI-feedback ADR decisions 3–5 | 1, 4–5 | PASS: bounded dispatch, reservation, remote-green reset, isolated repair, and sticky exhaustion remain compatible. |
| CI-fix StepRunner ADR | 3, 5 | PASS: shared dispatcher and daemon verification/publication remain; explicit result distinctions repair incorrect propagation. |
| CI-fix startup-preflight ADR decision 1, as amended | 3–4 | PASS: the approved in-place clarification resolves the old Claude-only requirement without weakening provider-native readiness. |
| Shared provider-execution/fresh-session ADR and Codex cold-session ADR | 3–4 | PASS: build configuration and session/fallback ownership remain shared, with one CI repair charge across its internal candidates. |
| Codex readiness ADR | 3, 6 | PASS: probe failure cannot become affirmative auth failure; safe diagnostics and existing real-invocation authority remain. |
| Canonical tracker-client and gh environment-gate ADRs | 1, 6 | PASS: use the canonical runner and typed errors, no raw substitute CLI factory or invented unsupported-field fallback. |
| Auth classification and daemon credential-gate ADRs | 3–4 | PASS: general auth gating is retained; the removed veto is the independent Claude-version probe, not global credential protection. |
| Provider preparation lifecycle supervisor | 3–4 | PASS: preserve synchronous spawn permission, fenced identities, and recovery bounds; no-start evidence never uses best-effort observers or creates a second lifecycle. |
| Provider time-partition ADR | 4, 6 | PASS: elapsed/usage evidence stays observational and does not become refund authority. |
| Draft PR, retained worktree, one-PR, and atomic halt-clear ADRs | 4–5 | PASS: readiness, retention, and operator halt state are not mutated by accounting/refund or publication-result classification. |
| Persisted halt-event spine ADR | 6 | PASS: the same union/persister pattern is reused for CI diagnostics; unrelated event sinks are not globally enabled. |
| Observed-close watch ADR | all | No opposing acceptance claim: it owns issue closure/observation metadata rather than CI-repair success or attempt accounting. Its spec-time observation declaration is handled before land without adding a repair watcher. |

## Six conflict classes and convergence

- Contradiction: the two previously reviewed startup assertions are replaced by the accepted policy; no new opposing assertion remains.
- Incompatible overlap: input preparation, execution, local verification, remote CI, and telemetry each retain their own authority.
- State conflict: reserved, proven not-started, attempted, locally published, and remote-green outcomes are distinct. Unknown results remain conservative.
- Resource contention: existing serial dispatch, per-tick limit, isolated worktrees, and lease protection remain; no new mutable shared ledger is introduced.
- Sequencing: context precedes repair; guards and verifier precede publication; remote green is observed later. No stage requires its downstream result in order to start.
- Oscillation: no local success resets a still-red PR to unlimited attempts, and a diagnostic failure cannot switch the same repair between charged/refunded states. Both-direction comparisons above found no mutually exclusive obligations.

## Verdict and verification basis

### Partial and full supersession audit

Two additional ADRs carry explicit partial-supersession status and were retained for clause-level review rather than excluded:

- `adr-2026-07-25-content-addressed-full-suite-proof`: its remaining decision 10 keeps CI-repair post-mutation checks independent of ordinary reusable BUILD proof. New Story 5 preserves the repair verifier; this feature does not widen evidence reuse. Compatible.
- `adr-2026-07-12-wiring-check-gate`: retained despite partial supersession. Its remaining reachability concern is not opposed by any new story; production boundary wiring and its proof remain required. This feature does not change the shared gate's placement or contract.

Unambiguously fully superseded statuses were excluded as controlling authorities: `adr-2026-07-21-completeness-as-build-review-rubric`, `adr-2026-07-30-finish-only-mergeability-gate`, `adr-2026-08-12-removal-anchored-tautology-exemption`, `adr-2026-08-15-verify-only-anchored-tautology-exemption`, `adr-2026-08-16-preservation-anchored-completeness-exemption`, `adr-2026-08-29-build-review-remediate-case-adjudication`, and `adr-2026-08-29-operator-authorized-kickback-budget-recovery`. The supersession audit found no other ambiguous superseded-status declaration to exclude.

PASS, 97% confidence, based on source/accepted-artifact comparisons and the explicit operator-approved resolutions. Zero blocking conflicts and zero accepted compromises remain. This is a design compatibility judgment, not runtime execution proof. Implementation must still deliver the exact boundary tests assigned during planning.

The earlier `ci-fix-resolver-autofix` conflict report is historical evidence of the former startup design; its prior clean verdict is not authority to resurrect superseded story assertions. The old story corrections have been made in this DECIDE change, not deferred to BUILD.

Review required: two previously identified blocking contradictions were resolved through approved story/architecture changes. No new ADR or scope expansion is required by this conflict pass.

## Approved ADR disposition inventory

The following entries are generated from the repository-wide status/title inventory and the examined set above. Narrowed-out entries own subjects outside the changed CI-repair behavior; they are not treated as superseded. Explicitly examined ADRs retain their applicable current clauses and amendments.

Approved ADRs inventoried: 305; examined: 18.

- `002-plugin-manifest-and-discovery` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `003-ui-renderer-plugin-point` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `004-when-parallel-workflow-dsl` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `005-when-undefined-key-falsy` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-002-engineer-store-and-retro-redirect` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-003-registry-write-and-integration` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-005-non-autonomy-and-read-only-governor` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-006-flywheel-lesson-selection-and-provenance` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-008-agent-hosted-loop-and-in-chat-authoring` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-009-intake-adapter-port` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-010-pidfile-lock-daemon-liveness` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-011-async-intake-queue-and-github-source` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-012-durable-intake-ledger-sole-dedup-authority` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-014-otel-observability-exporter` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-015-daemon-pr-labeling-sweep` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-06-29-architecture-before-stories-convergent-kickback` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-06-29-brainstorm-rename-migration` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-06-29-explore-prd-split-track-in-explore` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-06-29-memory-resilience-write-fallback-and-reconcile` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-06-29-per-project-memory-provider-selection` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-06-29-per-provider-retrieval-guidance-location` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-06-29-platform-adoption-and-removal-surface` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-06-29-rebase-conflict-resolution-dispatch` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-06-29-safe-reversible-memory-migration` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-06-29-shared-memory-store-placement-and-durability` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-06-29-track-marker-location` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-06-30-background-intake-brain-loop` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-06-30-engineer-worktree-authoring-isolation` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-06-30-grandfather-cutover-merge-time` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-06-30-halt-based-release-gates` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-06-30-origin-seeded-intake-routing` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-06-30-owner-gate-identity-resolution` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-06-30-owner-provenance-recording` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-06-30-sandbox-build-isolation` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-06-30-self-host-detection-seam` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-01-machine-scoped-operator-identity` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-03-daemon-auto-restart-stale-engine` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-03-dependency-fail-closed-and-cache` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-03-dependency-gate-backlog-waiting-channel` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-03-engineer-checkpoint-commits-idempotent-land` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-03-gated-snapshot-status-read-model` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-03-gated-writeback-announcements` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-03-generated-model-table-single-source` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-03-halt-pr-rehabilitation-at-finish` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-03-harness-daemon-profile` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-03-issue-dependencies-api-surface` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-03-owner-gate-gated-channel` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-03-post-rebase-force-with-lease` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-03-pr-timing-config-key` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-03-pr-timing-self-host-precedence` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-03-priority-fetch-fail-soft` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-03-priority-from-linked-issue-labels` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-03-prose-to-link-migration` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-03-reactive-model-fallback-ladder` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-03-version-gate-semver-escalation` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-04-auth-failure-park-and-poll` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-04-autoresolve-state-and-config` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-04-claim-time-delivery-evidence-guard` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-04-durable-pause-marker` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-04-event-driven-halt-clear-wake` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-04-kickback-event-emission-and-log-prominence` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-04-pending-restart-queue` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-04-resolution-worktree-lifecycle` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-04-respawn-in-place-restart` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-04-versioned-engine-store-atomic-flip` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-05-daemon-rate-limit-episode-coordinator` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-05-engine-owned-task-status` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-05-halt-pr-presentation-reliability` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-05-retry-as-escalation-ladder` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-05-standalone-bin-update` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-06-daemon-false-ship-guard` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-06-installed-root-resolution-for-global-writes` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-06-manual-test-fail-routing` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-06-migration-gate-waiver` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-06-stale-engine-respawn-in-place` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-07-audit-trail-event-sink` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-07-daemon-owned-build-credential` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-07-finish-record-primitive` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-07-ship-ci-feedback-loop` — examined; applicable comparison recorded above.
- `adr-2026-07-07-single-generation-stale-respawn` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-07-task-trailer-id-alias` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-08-halt-issue-closure-sweep` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-08-main-checkout-leak-triage-and-write-fence` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-08-post-rebase-gate-first-mechanical-reverify` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-09-deterministic-evidence-attribution-enforcement` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-09-setup-failure-triage` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-10-concurrent-group-core` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-10-daemon-stall-remediation` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-10-evidence-range-anchor-resolution` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-10-inline-work-attribution-enforcement` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-10-intake-claim-priority-banding` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-10-intra-step-build-progress-events` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-10-observed-close-watch-registry` — examined; applicable comparison recorded above.
- `adr-2026-07-10-park-marker-main-root-resolution` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-10-retire-migration-grandfather` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-10-session-hook-task-stamping` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-10-validation-group-join` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-11-attribution-abstain-or-loud` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-11-attribution-spot-audit-measurement` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-11-attribution-verdict-interface` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-11-evidence-judge-cli-and-cutover` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-11-finish-step-engine-completion-machinery` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-11-pipeline-state-durability` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-11-semantic-attribution-verification-lane` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-11-verdict-aware-resume-entry` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-12-progress-aware-build-halt` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-12-rebase-evidence-stamp-translation` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-12-wired-into-contract` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-13-kickback-build-no-op-escalation` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-13-park-all-dispatch-paths` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-13-retry-classify-rerun-vs-route` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-13-session-fresh-verdict-artifacts` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-17-verify-only-judged-closure` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-20-bounded-dirname-path-corroboration` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-20-ci-fix-dispatch-via-steprunner` — examined; applicable comparison recorded above.
- `adr-2026-07-20-ci-fix-startup-preflight-and-error-classification` — examined; applicable comparison recorded above.
- `adr-2026-07-20-post-rebase-delta-aware-invalidation` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-21-decide-time-unmerged-overlap-scan` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-21-demote-task-stamping-to-telemetry` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-21-engine-owned-acceptance-red-execution` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-21-intake-only-enforcement` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-21-no-diff-task-evidence-stamp` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-21-owner-stamped-at-authoring` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-21-s-tier-pipeline-knobs` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-21-serena-removal-path` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-22-attempts-counter-on-crash-recovery` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-22-auth-failure-classification-observed-401-patterns` — examined; applicable comparison recorded above.
- `adr-2026-07-22-build-dispatch-json-usage-capture` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-22-canonical-tagged-source-ref` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-22-canonical-tracker-client-seam` — examined; applicable comparison recorded above.
- `adr-2026-07-22-coherence-gate-placement-and-validation-split` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-22-coherence-waiver-and-duplicate-claim` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-22-daemon-level-missing-credential-gate` — examined; applicable comparison recorded above.
- `adr-2026-07-22-examples-state-isolation` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-22-gate-evidence-code-validity-on-redispatch` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-22-headless-vs-guided-examples` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-22-heartbeat-lease-deferred` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-22-intake-closed-issue-reconciliation` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-22-origin-refresh-before-engine-rebuild` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-22-per-feature-cost-rollup-in-shipped-record` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-22-per-task-work-happened-floor` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-22-phase-scoped-docs-write-guard` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-22-requeue-claimed-distinct-from-reopen` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-22-stale-claim-staleness-window-default` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-22-token-liveness-probe-via-cli-invocation` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-23-build-review-fresh-base-disposition` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-23-commit-movement-liveness-floor` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-23-intake-label-authority-scoped-replace` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-23-session-hook-repair-before-halt` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-23-trailer-union-build-step-routing` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope` — examined; applicable comparison recorded above.
- `adr-2026-07-25-custom-step-completion-artifacts` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-25-fail-closed-durable-shipment-evidence` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-26-concurrent-task-telemetry-and-symmetric-self-host-isolation` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-26-cross-dispatch-kickback-livelock-bound` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-26-daemon-decide-preseed-ownership` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-26-event-sink-registry-exhaustiveness` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-26-protected-artifact-seal-rebaseline` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-26-rebase-tail-current-branch-before-publication` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-27-ancestry-proven-park-reconciliation` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-27-codex-never-resumes-a-harness-minted-session` — examined; applicable comparison recorded above.
- `adr-2026-07-27-cold-start-within-step-retries` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-27-cost-unmetered-is-a-first-class-state` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-27-daemon-decide-kickback-halt` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-27-project-config-scaffolder` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-28-feature-aware-artifact-resolution` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-28-total-halt-classification-legacy-boundary` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-29-codex-readiness-probe-failure-disposition` — examined; applicable comparison recorded above.
- `adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main` — examined; applicable comparison recorded above.
- `adr-2026-07-29-deterministic-build-verification-fanout` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-29-engine-observed-provider-time-partition` — examined; applicable comparison recorded above.
- `adr-2026-07-29-operator-park-scheduling-unit-boundary` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-29-ship-start-draft-pr` — examined; applicable comparison recorded above.
- `adr-2026-07-30-contract-aware-same-file-wiring` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-30-pinned-remote-theme-for-pages-navigation` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-07-30-provider-preparation-lifecycle-supervision` — examined; applicable comparison recorded above.
- `adr-2026-08-01-bot-owned-release-pr` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-01-conduct-state-mutation-port` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-01-engine-owned-resumable-finish-publication` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-01-engine-owned-scoped-test-invocation` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-01-multi-proof-park-deletion-authority` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-01-rebase-full-replay-intent-validation` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-01-scoped-run-verb-release-surface` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-02-live-tier-asserts-outcomes-not-scripts` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-02-plan-scope-containment-at-commit-boundary` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-03-build-repair-member-reuse-validity` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-03-fail-closed-decide-entry` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-03-ledgered-per-block-migration-execution` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-03-uncommitted-work-floor-under-build-completion` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-04-classify-before-spend-release-smoke-gate` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-04-live-tier-provisions-its-own-provider-home` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-04-unresolved-step-command-fails-by-name` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-05-blocked-classification-after-dedup` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-05-blocked-is-a-distinct-state-from-halted` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-05-build-settle-outcome-stamp` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-05-every-dispatch-outcome-leaves-an-operator-lever` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-05-provenance-based-protected-artifact-inheritance` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-05-token-first-stories-reference-normalization` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-05-worktree-classification-evidence-derived-reasons` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-06-bounded-progress-allowance-for-finish-publication` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-06-honest-park-termination-boundary` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-06-publication-progress-is-its-own-disposition` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-07-project-teardown-hook-contract-and-containment` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-07-smoke-gate-goes-live-without-precharacterization` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-07-worktree-removal-coverage-guard` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-08-finish-human-required-halt-rendering` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-08-pipeline-owned-closeout-timestamps` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-08-repo-wide-adr-conformance-is-a-discovery-precondition` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-08-single-adr-approval-parser-three-rungs` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-09-adr-contradiction-detection-in-two-halves` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-09-adr-layer-gated-by-committed-adr-signal` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-09-bash-yaml-access-via-conduct-ts-config` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-09-checkout-is-sole-version-identity-authority` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-09-conductor-block-single-source-of-truth` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-09-declared-pattern-replication-in-build` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic` — examined; applicable comparison recorded above.
- `adr-2026-08-09-hook-owned-containment-event-ledger` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-09-legacy-json-seed-migration-rule` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-09-non-blocking-plan-scope-containment` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-09-one-pr-per-branch-halt-is-a-state` — examined; applicable comparison recorded above.
- `adr-2026-08-09-operator-only-scoped-artifact-reseal` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-09-recorded-red-exception-for-remediation` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-09-reseal-audit-rides-the-existing-event-spine` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-09-rotation-provenance-outside-the-pure-evaluator` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-09-seal-rotation-authorship-predicate` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-09-unverifiable-trigger-is-no-reachable-tag` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-09-worktree-local-provider-scratch` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-11-deprecated-no-op-step-retirement` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-11-halt-events-ride-the-persisted-spine` — examined; applicable comparison recorded above.
- `adr-2026-08-12-cumulative-build-review-convergence-bound` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-12-execution-lifecycle-completeness-for-timing` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-12-fail-closed-intake-ledger-durability` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-12-live-provider-coverage-from-plugin-registry` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-12-operator-reseal-as-second-scope-justification` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-12-per-provider-live-smoke-legs` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-13-durable-base-advance-attribution` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-13-engine-managed-build-review-rubric-branches` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-13-markdown-default-inversion` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-13-stable-build-review-finding-dispositions` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-14-retire-build-review-wiring-rubric` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-16-closed-build-review-finding-vocabularies` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-16-restore-the-current-head-publication-fence` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-17-framework-agnostic-tautology-scoped-run` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-17-structural-live-checkout-containment` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-18-content-anchored-finding-reference-schema` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-19-engine-stamped-rubric-judged-result-envelope` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-19-live-provider-stream-observation` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-19-operator-step-rewind-through-the-mutation-port` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-19-unretryable-step-runner-failures-route-by-kind` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-21-engine-identity-in-build-review-cache-key` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-21-review-bound-by-plan-done-when-criteria` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-22-as-built-review-runs-always-with-plan-gap` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-22-build-review-opt-in-rubric-container` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-22-done-when-evidence-at-task-close` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-22-one-owner-per-review-question` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-23-criterion-layer-is-structural-at-land` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-23-diff-locality-is-an-authored-disposition` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-24-evidentiary-defects-are-not-waivable` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-24-one-dispatch-member-on-the-provider-contract` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-24-over-scope-decision-block-and-durable-refusals` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-24-refused-step-status` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-25-as-built-remediable-findings-bounded-build-route` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-25-engine-stamped-ship-tail-verdict-run-identity` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-26-music-vocabulary-player-composer-rename` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-26-remove-retrospectives-one-shot` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-26-setup-once-per-worktree-marker` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-26-shared-coherence-parser-at-discovery` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-27-daemon-dispatcher-executor-seam` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-28-test-suite-drift-budget-and-verification-mode` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-30-shared-plan-task-reference-resolver` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-31-coverage-binding-judge-step` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-08-31-kickback-ledger-read-fails-closed` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-09-02-adr-decision-citability-contract` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-09-05-gh-cli-version-floor-and-environment-gate` — examined; applicable comparison recorded above.
- `adr-2026-09-06-engine-owned-test-quality-scope` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-09-06-inbound-intake-trust-boundary` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-09-06-reopened-task-resolution` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-09-07-durable-prd-widening-decision-reconciliation` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-09-10-portable-build-review-policy` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-09-10-separate-custom-review-coverage-identity` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-09-10-shared-step-lifecycle-telemetry` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
- `adr-2026-09-11-finish-mergeability-respects-active-review-inputs` — narrowed out; subject does not change CI-repair input, dispatch, accounting, publication, or diagnostics.
