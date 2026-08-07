# Architecture Review: fail-closed DECIDE entry for autonomous runs (#550)

**Date:** 2026-08-03
**Verdict:** APPROVED (full review — Tier L)
**ADR:** `adr-2026-08-03-fail-closed-decide-entry.md` (APPROVED)
**Reviewed against:** `.docs/architecture/daemon-autonomous-runs-must-fail-closed-on-any-amb.md`

## What was reviewed

The proposal to widen #551's `decideKickbackDisposition` into a fail-closed
`decideEntryDisposition`, consult it at all four navigation seams, retire the daemon's blind
DECIDE preseed in favor of a verified fast-forward, and add an explicit operator grant that is
the only way an autonomous run may enter DECIDE.

## Findings

### F1 — A naive "unsatisfied → halt" rule halts every daemon build (resolved)

The issue's desired outcome reads "unsatisfied → HALT naming the missing artifact", and
implementing that literally across all nine DECIDE steps is wrong. `explore` and `complexity`
have **empty** `STEP_ARTIFACT_CONTRACTS` entries, so `stepHasCompletionCheck`
(`conductor.ts:889-893`) returns false and no artifact can ever satisfy them. Every daemon
dispatch would halt on `explore` before reaching BUILD — a total outage, shipped as a safety
fix.

The resolution is a structural distinction, not a name list: a step with **no contract** has
nothing to verify and fast-forwards as `skipped` (ADR D1 rule 5); a step **with** a contract
whose check fails or throws is genuinely ambiguous and halts (rule 8). Fast-forwarding a
contract-less step still honors the invariant, because the harm #550 names is *dispatching an
authoring session* and a fast-forward dispatches nothing. Story S7 pins the healthy-path
assertion (zero DECIDE dispatches, run reaches BUILD); Story S1 pins the halt for a contracted
step. Resolved.

### F2 — The fail-open default is the defect, and it is not where the intake pointed (resolved)

The intake hypothesized "a daemon-mode step-policy check at dispatch time … is likely a few
lines". Dispatch-time is necessary but not sufficient. Three separate fail-open defaults sit on
the authorization boundary, and none is at the dispatch seam:

- `decideKickbackDisposition` returns `route` when `steps.find(...)?.phase` is `undefined`
  (`kickback-policy.ts:12-20`);
- `earliestRemediationTarget` skips any gap whose `disposition` matches no step and returns its
  `'build'` initializer (`conductor.ts:7999-8008`) — an unresolvable target is not just routed,
  it is routed somewhere it was never asked to go, and dispatches a provider;
- `scanKickbackVerdicts` iterates only `topo.kickbackTargets` (`conductor.ts:7025`), so a
  verdict naming an unknown or custom target is dropped with no event and no trace.

The filer's hypothesis is recorded as a candidate and **partially adopted**: the dispatch-time
check is real and is D3's first seam, but "a few lines" understates it by an order of magnitude.
ADR D1 rule 2 and D4 close the three defaults. Resolved.

### F3 — Two satisfaction authorities is the root cause; collapsing to one is load-bearing (resolved)

`preseedStepStatuses` (`daemon-cli.ts:362-372`) stamps DECIDE `done`/`skipped` from the step
table alone, reading no artifact, and the engine then trusts that status verbatim at
`conductor.ts:3081-3088`. The bootstrap asserts a fact it never checked and the engine believes
it. Retaining the preseed and adding only a dispatch guard — the smaller, safer-looking change —
would leave the issue's own observable test failing (delete `.docs/stories/<slug>.md`, daemon
still walks into BUILD).

ADR D2 reduces `PRESEEDED_DONE` to `['worktree','memory']` and makes the engine the single
satisfaction authority, consistent with `adr-2026-07-11-verdict-aware-resume-entry`. The
alternative is recorded and rejected in the ADR with this reasoning. Resolved.

### F4 — Clearing the HALT must not be an authorization (resolved)

`needs-human` HALTs are never auto-cleared (`daemon-rekick.ts:184-196`), and the documented
operator recovery is `rm -f .pipeline/HALT .pipeline/HALT.class`
(`docs/runbooks/stalled-or-stuck-feature.md:426,447`). If a cleared HALT re-permitted DECIDE
entry, that routine gesture would silently become a grant of authoring authority, unrecorded and
unscoped — the guard would be defeated by its own recovery procedure.

ADR D6 makes the grant a separate, explicit, step-scoped, single-use artifact written only by
`conduct decide-grant`. Story S6 asserts the negative directly: clear the HALT with no grant,
resume, and the run re-halts identically. Resolved.

### F5 — The grant must not be self-grantable (resolved)

A `--allow-decide` daemon flag was considered and rejected in the ADR. It is run-scoped rather
than step-scoped, and it lives in the daemon's own invocation — the daemon would be authorizing
itself, which makes the invariant vacuous. The chosen design has no code path by which the
daemon creates a grant. Story S6 asserts single-use consumption so one grant cannot authorize a
second entry later in the same run. Resolved.

### F6 — Halt classification is load-bearing (carried forward from #551 F2, still binding)

Only `needs-human` is skipped by `rekickSweep` on every sweep; `mechanical` and `unclassified`
are re-kicked. Every halt from this policy must use
`writeHaltMarker(projectRoot, body, 'needs-human')`, and the acceptance criteria must assert the
`.pipeline/HALT.class` **sidecar content**, not merely that `.pipeline/HALT` exists. Pinned by
ADR D5 and asserted in S1, S2, S3, S4, S5. Resolved.

### F7 — Do not enforce inside `navigateBack` (carried forward from #551 F4, still binding)

`navigateBack` (`conductor.ts:377`) is shared with the rebase-invalidation re-open and the
deterministic BUILD kickbacks. Enforcement there would over-block or would need the same phase
test anyway. Enforcement stays at the four decision seams. ADR D3. Resolved.

### F8 — #551's ordering inside `scanKickbackVerdicts` must be preserved byte-for-byte (resolved)

#551's F3 fixed the order as counter bump → event emit → cap check → phase check →
`navigateBack`, so that a capped daemon run still reports the ping-pong reason rather than
masking it behind a phase refusal. Widening the predicate must not move it. ADR D3 restates the
ordering explicitly and Story S3 asserts the cap-exhaustion reason is unchanged. Resolved.

### F9 — Derive everything from the `steps` table, never a name list (carried forward, still binding)

`phase`, `kickbackTarget`, and `skippableForTiers` are all configurable per step, and custom
steps are inserted via `after`. A hardcoded `['prd','architecture_review','stories','plan']`
would silently exempt a config-added DECIDE step — the exact failure this guard exists to
prevent. The predicate takes `StepDefinition[]` and resolves phase, tier-skippability, and
`hasContract` from it. ADR D1. Resolved.

### F10 — Two tier defaults for one question (resolved, latent)

The preseed defaults an unresolved tier to `'M'` (`daemon-cli.ts:363`); the forward loop
defaults it to `'L'` (`conductor.ts:3091`). This is inert today — every `skippableForTiers`
value in `steps.ts` is `['S']` or `[]` — but it is a live trap the moment any step becomes
M-skippable. D2's move of tier resolution into the engine collapses it to the engine's `'L'`,
which is also the conservative answer. Noted in the ADR's D2. Resolved.

### F11 — This guard will surface latent bad specs as HALTs (accepted risk)

Specs that merged incomplete, or were damaged mid-flight, previously slid past into BUILD. They
will now halt on first contact. This is the intended behavior change, not a regression, and it
is bounded: discovery's existing eligibility filter (`daemon-backlog.ts:755-806`) already
warn-skips malformed specs before they enter the backlog, so the population reaching this guard
is small. The HALT payload (D5) names the missing artifact path, so each is directly
actionable. Accepted; the runbook update in the plan covers the operator procedure.

## Assumptions surfaced

| # | Assumption | Confidence | Basis | Impact if wrong |
|---|---|---|---|---|
| A1 | The daemon always constructs the `Conductor` with `daemon: true`, so `this.daemon` is a reliable autonomy discriminator | 90% | inferred — both existing #551 seams already rely on it as their sole discriminator | Guard silently inert; caught by S1's acceptance test |
| A2 | `checkStepCompletion` is file I/O only for all DECIDE steps and dispatches no provider | 95% | verified — `artifacts.ts:3547-3555` resolves a predicate or globs; the post-dispatch call site already runs it per step | Healthy path gains cost, violating the issue's negative-path requirement; caught by S7 |
| A3 | The daemon runs with `mode: 'auto'`, so `runComplexityStep` never calls a provider | 85% | inferred — `conductor.ts:7756-7762` short-circuits on `auto` with "No prompt, no Claude call" | `complexity` could dispatch; rule 5 fast-forwards it regardless, so the invariant holds either way |
| A4 | No consumer depends on `PRESEEDED_DONE` containing DECIDE steps beyond the two known test imports | 80% | verified for this repo — `audit-trail-daemon-wiring.integration.test.ts:41` and `daemon-decide-preseed-ownership.acceptance.test.ts:61` are the only importers | Those two specs need updating in the same diff; the plan's Task 4 covers it |

None of these is unconfirmed in a way that changes the design: A1 and A2 are verified or
directly test-pinned, and A3's failure mode is already handled by rule 5. No HARD-BLOCK.

## Verdict

**APPROVED.** The design closes all five defects with one predicate rather than five guards,
reverses the fail-open default at the authorization boundary, and keeps the healthy path free of
added dispatches. F1 was the material finding — it would have shipped a total daemon outage as a
safety fix — and is resolved structurally rather than by special-casing step names. Proceed to
stories.
