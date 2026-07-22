# Conflict Check: build-auth-token-check-and-classify

**Date:** 2026-07-22
**New stories:** `.docs/stories/build-auth-token-check-and-classify.md` (FR-1..FR-7, Accepted)
**Scanned against:** full `.docs/stories/` inventory; deep pairwise reasoning on the
auth/park/retry/daemon-loop cluster (13 files): isolate-daemon-build-auth-from-operator-oauth,
sandbox-auth-expiry-park, park-all-dispatch-paths, retry-as-escalation,
rate-limit-wait-signal, daemon-api-rate-limit-episode-cascades-into-mass-h,
setup-before-dispatch-wedge, setup-triage-must-not-report, daemon-event-driven-wake,
guard-bin-install-relink, harness-self-host-guardrails, fresh-build-dispatch-halts,
park-and-unpark-resolve-repo-root. Remaining files judged orthogonal by title/domain
(no auth/dispatch-gate surface).

**Result: PASSED — zero blocking conflicts.** 2 conflicts resolved by story annotation,
1 coverage gap fixed in the new stories, 2 degrading items accepted with notes.

---

## Conflict 1: Falsified backstop-validity criterion (resolved)

**Stories:** build-auth… FR-4 vs isolate-daemon-build-auth-from-operator-oauth (TR-5 smoke)
**Type:** contradiction · **Severity:** degrading (resolved)
**Confidence:** 95% — verified live 2026-07-22.

TR-5 asserted a corrupted token's failure output "matches `AUTH_FAILURE_RE` — proving
the existing signature classifies token-mode failures." Observed reality: output is
`Failed to authenticate. API Error: 401 Invalid bearer token`, which does not match —
the #484 retry-ladder burn. Both cannot be true.

**Resolution applied:** FALSIFIED annotation added to the TR-5 criterion in the #351
story, pointing at FR-4 + adr-2026-07-22-auth-failure-classification-observed-401-patterns.
No ADR superseded (adr-2026-07-04's park semantics are unchanged; only the pattern set
grows).

## Conflict 2: Per-feature preflight HALT vs daemon-level gate (resolved)

**Stories:** build-auth… FR-6 vs isolate-daemon-build-auth… (TR-3)
**Type:** behavioral overlap · **Severity:** degrading (resolved)
**Confidence:** 90%.

TR-3: missing token → per-feature HALT at preflight. FR-6: missing token → the daemon
parks before dispatching any feature (zero per-feature HALTs). Layered, not exclusive:
the gate front-runs; preflight semantics are byte-identical whenever preflight is
actually reached (races, mid-cycle deletion, non-daemon runs) — as pinned in
adr-2026-07-22-daemon-level-missing-credential-gate.

**Resolution applied:** front-run annotation added to TR-3 in the #351 story.

## Conflict 3: Missing gate-composition criterion (resolved)

**Stories:** build-auth… FR-6 vs park-all-dispatch-paths + rate-limit-episode stories
**Type:** overlap/coverage gap · **Severity:** degrading (resolved)

Precedent pins that pre-dispatch gates compose (PAUSE authoritative, operator-park
unconditional, in-flight features never cancelled). The new FR-6 story lacked a
composition criterion, leaving ambiguity about credential-clear bypassing other gates.

**Resolution applied:** composition criterion added to the FR-6 story (all gates must
pass; in-flight untouched).

## Accepted item 4: Non-blocking gate implementation note (for /plan)

FR-6's "park the cycle" MUST NOT be implemented as a loop-blocking wait: the
daemon-event-driven-wake story requires the loop to keep servicing HALT watchers,
sleep/wake arms, and episode handling. Implement as a skip-picks gate (the rate-limit
episode pattern, beside `checkPaused`) with the credential-file watcher arming the
existing waker for prompt auto-resume. Observable ADR semantics (one condition, zero
dispatch, auto-resume) are unchanged — this is an implementation constraint, not an
ADR change.

## Accepted item 5: bin/install resource contention (degrading, accepted)

`bin/install` is touched by ~29 unmerged spec branches (overlap-scan). Merge-conflict
risk is accepted; mitigation locked in the architecture review: the bash diff is a
thin delegate call only. Also checked: guard-bin-install-relink requires `--check` to
stay guard-free/read-only in worktree roots — the token check is read-only and
root-independent, compatible.

---

**Sequencing/state/resource scan on the remaining pairs:** setup-triage (setup
failures, not auth), fresh-build attribution guard (task-status seeding), wake
machinery (HALT-clear watch), park-cli root resolution — all orthogonal to the new
stories' surfaces; no impossible states identified. Sole shared-state surface is the
`.pipeline/HALT` marker family, where FR-6 only *reduces* writes (gate prevents
cascades) and never changes marker format or clear/rekick semantics.
