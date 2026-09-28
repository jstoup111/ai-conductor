# ADR: Operator-launched provider sessions retain conductor authority

Date: 2026-09-20
Source: jstoup111/ai-conductor#1228
Review mode: full, Tier L, product track
Status: APPROVED
Deciders: James Stoup, operator approval in composer session on 2026-09-20.

## Confirmed scope

This ADR settles how the guided session for a queued halt is launched, what authority it holds, and
where it runs (PRD OQ-1, OQ-6). The queue's state architecture is settled separately by
adr-2026-09-20-halt-resolution-queue-derived-from-markers. Out of scope: any unattended session, any
change to the existing triage procedure or its approval contract, and any change to what the engine
dispatches.

## Context and evidence

Verified in execution/daemon-session.ts: the module enforces a boundary at two seams. Marker
injection stamps `CONDUCT_DAEMON_SESSION=1` into every provider child session the engine spawns, and
an entry guard refuses to run the conductor CLI at all when that marker is present, before any
subcommand parsing. The module states its purpose plainly: engine-dispatched maker sessions have
recursively invoked the conductor to park, unpark, restart and reseal — operations belonging to the
engine that dispatched them. It carries a closed set of eight session-sanctioned worker subcommands
(`scoped-run`, `task`, `overlap-scan`, `plan-protected-targets`, `manual-test-record`,
`closeout-event`, `derive-feedback`, `scope-check`) and an explicit instruction not to add
daemon, engineer, or state-mutating verbs to it. There is deliberately no configuration off-switch;
the only bypass is a test-only environment valve that nothing in production sets.

Verified in execution/claude-provider.ts: the marker is applied inside `buildEnv`, unconditionally,
for every invocation through the adapter. It is not conditioned on the invocation being
non-interactive, so the adapter's `interactive: true` path is marked identically. The same pattern
holds for the other provider.

Consequence, verified by reading the sanctioned set against the triage procedure's own commands: a
guided session launched through a provider adapter could not run daemon status, park, unpark,
rewind, or kickback-budget — the operations the recovery procedures are built from. It could gather
evidence and advise; it could not act.

Verified in engine/engineer-cli.ts: a precedent for the opposite shape already ships.
`launchClaudeEngineer` spawns the provider binary directly with inherited stdio and resolves on the
child's exit code. Because it does not pass through the adapter's environment builder, the session
carries no marker and retains full conductor authority — which is precisely why an operator's
composer session can run conductor verbs. That launcher hardcodes one provider and one provider's
permission-mode flag and slash-command syntax.

Verified in provider adapters: neither provider can construct a session-resume invocation. The
resume argv branch was deleted rather than disabled, so the absence is structural. Interactive
recovery therefore cold-starts and receives its failure context as an explicit rendered input.

Verified in the provider execution attachment point: no dispatch on any provider supplies a stream
consumer when the invocation is interactive. A launcher cannot observe the session it started; it
learns only the exit code.

Verified in AGENT_INSTRUCTIONS.md, Daemon Operations Safety rule 5: the self-host live boundary
fingerprints the root checkout and re-verifies it, and an interactive operator session writing
untracked provider configuration into the live root is the recorded cause of a real halt on
2026-08-04 that wasted a completed build. The same section lists the excluded paths under which a
change is safe, `.worktrees/` among them, and states plainly that the exclusion list must not be
widened to fix this.

## Governing decisions and reuse check

- adr-2026-07-27-cold-start-within-step-retries, especially §5: neither adapter can construct a
  resume invocation; interactive recovery cold-starts and receives its context as an explicit
  rendered input. Reused directly.
- adr-2026-07-27-codex-never-resumes-a-harness-minted-session: session resume is a declared provider
  capability, fail-closed, and the invariant is structural rather than a runtime check.
- adr-2026-07-24-provider-aware-step-execution-fresh-session-scope, especially §5: persistence may
  correlate an invocation with its owner but never authorizes resume.
- adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot, especially D4: no
  dispatch supplies a stream consumer when interactive. Reused as the reason exit is the only
  outcome signal.
- adr-2026-08-24-one-dispatch-member-on-the-provider-contract: the provider contract carries one
  dispatch member; live observation is a seam on it.
- adr-005-non-autonomy-and-read-only-governor: automation may start a daemon but never manages one,
  holds no control connection, and writes no daemon-supervision state. Preserved, not altered.
- adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting, sub-decision 2: lifecycle verbs are
  a human-operator capability; automation never attaches to an operator's session. Preserved.
- adr-2026-08-17-structural-live-checkout-containment: containment is proven, never assumed.
- adr-2026-07-01-machine-scoped-operator-identity: operator identity resolves from machine-scoped
  configuration only. Inherited unchanged; this feature introduces no second notion of the operator.

No existing ADR governs the daemon-session invocation boundary — it shipped as machinery without
one. A new ADR is warranted because this proposal establishes the rule that decides which sessions
hold conductor authority, which is an integration and authority boundary rather than an
implementation detail. Leaving that rule implicit is what would make the boundary erodible.

## Alternatives

### A. Launch outside the adapter; session retains authority — selected by operator

The monitor launches the configured provider directly, as the composer launcher already does, so the
session carries no marker and can carry out recovery under the existing per-action approval
contract. Requires generalising the existing single-provider launcher into a provider-agnostic seam.
Requires stating the boundary rule explicitly so the bypass cannot be reused to smuggle authority
into an engine-dispatched session.

### B. Launch through the adapter's interactive path

No new seam, provider-agnostic for free. Rejected: the session would be marked and could not run any
recovery command, so the feature would reduce to a reading-and-advice tool while the operator
retyped every action in another terminal. That defeats FR-16 and most of the value.

### C. Widen the sanctioned-subcommand set

Add the recovery verbs to the exemption list so a marked session may run them. Rejected, and
rejected firmly: the exemption list is the guard's whole substance, the module explicitly forbids
adding state-mutating verbs to it, and widening it would grant those verbs to every engine-dispatched
build session as a side effect — exactly the recursive park/restart/reseal failure the guard was
built to stop. The problem is not that the list is too narrow; it is that the guard's subject is
"engine-dispatched", and a marked operator session was never its subject.

## Decision

1. **The marker marks engine-dispatched sessions; an operator-launched session is not one.** The
   daemon-session boundary exists to stop a session the engine dispatched from reaching back and
   steering the engine that dispatched it. A session an operator starts from their own foreground
   command, on their own behalf, at their own terminal, has no dispatching engine to subvert: the
   operator is already the authority those verbs answer to. That distinction — not the narrowness of
   the exemption list — is the boundary's actual subject, and this decision states it so the rule is
   reviewable rather than implicit.

2. **The sanctioned-subcommand set is not widened, and the guard is not weakened.** No verb is added
   to the exemption list, no configuration off-switch is introduced, and the entry guard's behavior
   for a marked session is unchanged in every respect. A session that carries the marker remains as
   constrained as it is today. This ADR changes nothing about what a marked session may do; it
   decides only which sessions are marked.

3. **A provider-agnostic interactive launch seam is the sole place a session is spawned outside the
   adapter.** The existing single-provider launcher is generalised so the operator's configured
   provider is honoured rather than one provider being hardcoded, including that provider's own
   interactive invocation form. Every unmarked session in the system is spawned through this one
   seam, so the set of sessions holding conductor authority is enumerable by reading one module
   rather than inferred from scattered spawn sites.

4. **The seam is reachable only from a foreground operator command with an attached terminal.** It
   is not reachable from the daemon, from a step runner, from a dispatched build, or from any
   automated path, and it refuses to launch when no interactive terminal is attached. This is the
   invariant that keeps D1 honest: without it, "operator-launched" degrades into "whatever calls the
   launcher", and the boundary erodes exactly as the guard's module history warns. The restriction
   is structural — enforced at the seam — rather than a documented expectation, and it is a
   behavioral claim the feature's tests must pin rather than assert in prose.

5. **The guided session runs with the halted feature's worktree as its working directory.** Provider
   sessions acquire permissions and write provider configuration as they run; doing that in the live
   root checkout is the recorded cause of a self-host build halt that discarded completed work.
   Feature worktrees are already a live-boundary excluded path, so a session confined to one cannot
   trip the fingerprint. The exclusion list is not widened to accommodate this feature. Where a
   recovery action must legitimately touch the main checkout's own state, it runs as an approved
   action under D7 rather than by relocating the session.

6. **Every guided session is a cold start carrying rendered context, and its outcome is its exit.**
   No session is resumed — the capability is structurally absent on both providers — so the halt's
   evidence and identity are rendered into the session's opening input. Because no interactive
   dispatch may supply a stream consumer, the monitor cannot observe the session it launched and
   learns only that it exited. Exit is therefore never interpreted as resolution: whether the halt
   survived is re-derived from its marker on the next pass, per
   adr-2026-09-20-halt-resolution-queue-derived-from-markers D1.

7. **The session inherits the existing triage approval contract unchanged.** Diagnosis remains
   unconditionally read-only. Every state-changing action is presented with its blast radius and
   individually approved before it happens; approval is never batched, and approving a diagnosis is
   never approval to act on it. Retaining conductor authority under D1 widens what the session may
   be *asked* to do; it does not relax what it may do *unasked*, and the monitor adds no standing
   consent of its own.
