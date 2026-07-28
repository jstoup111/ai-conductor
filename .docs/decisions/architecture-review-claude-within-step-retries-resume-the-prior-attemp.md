# Architecture Review: Claude Declares No Resume (#1071)

**Date:** 2026-07-27
**Tier:** M (lightweight review)
**Verdict:** APPROVED with four mandatory conditions
**ADR:** `adr-2026-07-27-cold-start-within-step-retries` (APPROVED)
**Depends on:** spec PR #1069 / `adr-2026-07-27-codex-never-resumes-a-harness-minted-session`

## What was reviewed

The proposal to complete the operator's end state — a fresh session for both Claude and Codex on
every iteration — by flipping Claude's `supportsSessionResume` declaration to `false` and
closing the gaps #1069 leaves open, reviewed against #1069's authored spec and against the
current implementation in `src/conductor`.

**Revision note.** An earlier draft of this review was authored without knowledge of #1069,
which was opened roughly fifteen minutes before that session began. It concluded that #903 had
landed nothing, that Codex resume worked and was exercised, and that a `supportsSessionResume`
capability should be rejected. All three were wrong. This review supersedes it; F1 and F2 record
the corrections rather than hiding them, because the same mistake — specing against `main`
without checking open spec PRs — is cheap to repeat.

## Findings

### F1 — Codex resume never worked; the providers were not "identically wrong" (blocking, corrected)

The superseded draft claimed Codex resume was "fully implemented and exercised by passing
tests", concluding both providers resumed and were identically wrong. #1069 establishes
otherwise, verified in #1042 against `codex exec --help` / `codex exec resume --help`:

- The harness mints a `uuidv4` (`provider-session.ts:34`); Codex rollout ids are `uuidv7` and
  are minted **by Codex**.
- `codex exec` exposes no flag to pre-register a caller-supplied id.
- Therefore `codex exec resume «harness-uuid»` (`codex-provider.ts:496-498`) can never resolve.

Every Codex retry spends a real provider invocation discovering something knowable before
dispatch, then has the failure absorbed by `CODEX_SESSION_EXPIRED_RE`. The passing tests were
fake-provider tests that never modeled the real failure — which is exactly why #1069's plan adds
a Codex fake that mints its own uuidv7-shaped thread id and **fails** any `resume: true`
invocation.

Correct characterization: **Claude genuinely resumes; Codex silently burns an invocation per
retry.** Two different defects, not one shared one.

### F2 — The capability flag is the right seam, and rejecting it was wrong (blocking, corrected)

The superseded draft rejected `supportsSessionResume` on the grounds that, with neither provider
resuming, it would have no reachable `true` case. That reasoning evaluated the end state while
ignoring the path to it. #1069 introduces the capability precisely so Claude can flip **later,
as its own change with its own evidence** — Claude's resume mechanism is functional, and
removing it changes token cost and behavior on the default execution path.

The capability is a sequencing instrument. This feature is the sequel it was built for.
**Condition: this feature consumes #1069's capability rather than re-litigating it**, and must
not introduce a parallel mechanism.

The end-state objection is still real but resolves differently — see F5.

### F3 — #1069's "single place resume is decided" is an over-claim (blocking, new)

#1069's ADR Decision 2 states that `runProviderInvocation` "becomes the single place resume is
decided", and its architecture review cites `group-core.ts:438-444` as evidence that all
dispatch paths funnel through the gate. Verified false in the general case:

- `step-runners.ts:613` returns into `runProviderAwareNormal` **only** when
  `this.providerRuntimes` is set **and** no `branchSessionId` was supplied. Otherwise dispatch
  falls through to `provider.invokeInteractive` at `:630`, carrying the `resume` computed
  locally at `:529-530` (`resume = this.sessionStarted`) — never entering
  `provider-execution.ts`.
- `group-core.ts:464-469` computes `const resume = hasRun` and feeds that same scalar path via
  `branchSessionId` when no `providerSessions` scope is supplied.

So after #1069 alone, Codex is cold-start-only **on the provider-aware path**; the scalar paths
remain ungated. This does not block #1069 — Codex's argv deletion (its Decision 3) makes a Codex
resume unconstructable regardless of which path requests one, so #1069's own guarantee holds by
a different mechanism than its prose claims. But it does mean the capability gate cannot be the
sole instrument for Claude.

**Condition: close both scalar paths at their own source**, and mirror #1069's structural
approach by deleting Claude's `--resume` argv branch so the invariant does not depend on any
gate being reached.

Confidence 90%, basis: read `step-runners.ts:613`, `:630`, `:529-530` and `group-core.ts:444-495`
directly. If the scalar paths turn out to be unreachable in production, the corresponding tasks
become no-ops and their tests still document the invariant — cheap either way.

### F4 — Resume suppression and identity minting remain one change (blocking, carried forward)

`claude-provider.ts:649-653` selects `--resume «id»` versus `--session-id «id»` on the flag
alone, and #1069's plan explicitly declines to touch id minting (non-goal: *"Do not change
`ProviderSessionStore` id minting or scoping"*). So the moment Claude declares `false`,
`prepare()` still returns the scope-stable id and attempt 2 sends `--session-id` against an id
the CLI already registered — the `SESSION_IN_USE_RE` condition. Every Claude retry would burn a
`session_reset` cycle.

#1069's own deferral note records this finding and assigns it here. **Condition: per-invocation
minting ships in the same change as the declaration flip.**

### F5 — Retaining the flag with no `true` case is correct; deleting it is churn (advisory)

Once Claude declares `false`, `supportsSessionResume` has no reachable `true` case — the
superseded draft's objection, now arriving one feature later than it thought. The resolution is
not to delete it:

- It is #1069's fail-closed contract point: an adapter that omits the declaration is treated as
  non-resuming, which keeps adapters added later correct by default.
- With both `buildArgs` resume branches deleted, a `true` declaration could not construct a
  resume argv anyway. The flag documents the invariant; the adapters enforce it.
- Removing a seam one feature after it lands, before any third adapter exists to justify the
  decision either way, is churn.

Recorded as ADR Decision 4. `ProviderSession.created`, `markCreated`, and `forceFreshSession` do
become genuinely vestigial, and are evaluated for deletion only after the F7 guards are green.

### F6 — `runInteractive` is a real regression risk and needs its own story (blocking, carried forward)

`step-runners.ts:1141-1166` sends `Fix issues from the failed «step» step, then exit when done.`
with an empty system prompt and `resume: true`; the provider-aware branch passes no
`providerSessions`, so it inherits the step scope's `created`. All of its context lives in the
conversation it resumes. Both callers (`conductor.ts:4785` stall-breaker, `:5808` recovery menu)
are operator-facing and non-auto.

#1069 cites this as #1071's work. `retryHint` already exists at `conductor.ts:4076` in the right
shape. **Condition: this is a separate story with its own acceptance criteria and must not be
folded into the mechanical change.**

### F7 — Recovery machinery must not be swept up as dead code (advisory)

With no provider resuming, `STALE_SESSION_RE` / `SESSION_IN_USE_RE` / `CODEX_SESSION_EXPIRED_RE`
lose their most common trigger and will look dead to a cleanup pass. They are not: an id
collision, external interference, or a torn-down self-host home still reaches them, and
`session_reset` recovery is non-budget-consuming, which matters for retry accounting.

#1069's `session_policy` diagnostic also changes character — after this feature it fires for
every dispatch, so its once-per-step scoping stops being a nicety and becomes the thing standing
between it and log spam. ADR Decision 6; asserted in ST-1071-5.

### F8 — Telemetry correlation is not at risk (advisory)

`.pipeline/conduct-session-id` is written only from the step runner's own `this.sessionId`
(`step-runners.ts:659, 926, 1137`); `ProviderSessionScope` never writes it. Per-invocation
provider identity does not churn `conductor.run.id` (`otel/resource.ts:46-55`). Recorded as ADR
Decision 7 so a future implementation cannot quietly introduce a dependency.

### F9 — Test files are touched by both features in sequence (advisory, feeds the plan)

#1069 amends the **Codex** half of several suites and instructs "Amend, never delete — each test
also carries the Claude invariant". This feature amends that surviving Claude half. The overlap
is intentional and sequential, not a conflict, but it means this feature must be rebased on
#1069 before its test edits will apply cleanly:

- `per-step-provider-routing-927.acceptance.test.ts:922-973` — #1069 changes the Codex half and
  explicitly keeps `claude.calls[1].resume === true`; this feature inverts that line.
- `conductor.test.ts:9082-9245` — #1069 amends the Codex expectation and keeps the Claude one.
- `retry-as-escalation.acceptance.test.ts:325-377`, `provider-session.test.ts:178-195`,
  `provider-execution.test.ts:164`, `step-runners.test.ts` (four sites), `session.test.ts:89` —
  Claude-only, untouched by #1069, inverted here.

`provider-execution.test.ts:116` (self-host never resumes) survives unchanged under both.

## Alignment with repository design principles

**Deterministic where possible.** Deleting Claude's `--resume` argv branch makes the invariant
structural — a future call site cannot reintroduce a resume by forgetting a flag. This is the
same reasoning #1069 applied to Codex, and it is why F3's gate gap does not sink the design:
the guarantee does not depend on every path reaching the gate.

**No provider-conditional prose.** After both features the contract is one sentence with no
qualifier, which is what makes ST-1071-6's documentation work a deletion of exceptions rather
than an addition of caveats.

## Conditions on APPROVED

1. Consume #1069's capability; do not introduce a parallel mechanism (F2).
2. Close both scalar dispatch paths at their source, and delete Claude's `--resume` argv so the
   invariant is structural rather than gate-dependent (F3).
3. Per-invocation id minting ships with the declaration flip, never after it (F4).
4. `runInteractive` gains explicit failure context before it cold-starts (F6).

## Sequencing requirement

**#1069 must merge before this feature builds.** Building against `main` would require inventing
the capability this feature is meant to consume, guaranteeing a conflict at merge. The plan's
first task asserts the capability already exists and halts if it does not.
