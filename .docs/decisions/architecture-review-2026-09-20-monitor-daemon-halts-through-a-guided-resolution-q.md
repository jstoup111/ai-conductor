# Architecture Review: Monitor daemon HALTs through a guided resolution queue

**Date:** 2026-09-20
**Source:** jstoup111/ai-conductor#1228
**Mode:** full pass, Tier L, product track (pre-stories)
**Stories reviewed:** none — this is the pre-stories run; the review's input is the PRD's FR-1..FR-27
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | Feasible with the current stack. No new dependency, service, port, or datastore. The one live-watch dependency already ships and is used at a single site. |
| Prerequisites | None external. Two existing surfaces need extending rather than creating: the halted-entry shape must carry the halt class, and the single-provider interactive launcher must be generalised. |
| Integration surface | Wide but shallow. Touches the CLI dispatch chain, the CLI help declaration, the state-scanning module, the halt-marker module, the event union and its sink registry, the priority resolver, and the provider launch path. No module is restructured. |
| Data implications | No schema, no migration, no backfill. One new small per-repo state file (the deferral record) under an already-excluded directory. |
| Performance risk | The real cost is the priority signal: one network call per linked reference per resolution pass. The existing resolver already caches in-process and suppresses repeat fetches for references it has attempted, and degrades to a warning plus fallback ordering on outage. A monitor polling several projects must reuse that resolver rather than re-fetching per pass. |
| Worktree isolation | Satisfied structurally. The monitor is read-only over other projects; the guided session is confined to the halted feature's own worktree; the deferral record is per-repo under the main root's daemon directory. Two operators running monitors over the same repo is addressed under Risks. |

**Confidence.** High (≈90%, verified) on the mechanism claims: each is read from source and cited in
the ADRs. Medium (≈70%, inferred) on effort, because the provider-agnostic launcher must handle a
second provider's interactive invocation form, and only one provider's form is demonstrated by the
existing precedent.

**The one genuinely novel piece** is the provider-agnostic interactive launch seam. Everything else
is composition of shipped parts. That seam is where a spike would pay for itself if the second
provider's interactive form resists the abstraction.

## Complexity

**High** by the skill's rubric — the feature crosses six module boundaries, introduces a new
authority boundary, and adds members to the event union. It is not a candidate for splitting: the
loop is only coherent with all of discovery, ordering, launching, and advancing present. Removing
any one leaves something that does not solve the operator's problem.

The complexity is concentrated, not diffuse. The launcher seam and the boundary rule carry most of
it; the queue itself is small precisely because it stores nothing.

## Alignment

**Conforms.**

- **State placement.** The deferral record follows the established rule — per-repo operator state
  under the main root's daemon directory, resolved through the shared main-root seam, with its path
  and helpers in one module (adr-2026-07-04-operator-park-marker D2/D6,
  adr-2026-07-10-park-marker-main-root-resolution).
- **Event spine.** Transitions extend the union with exhaustive sink declarations; the deferral
  record is exception-C durable state, not a second event-shaped ledger. This follows the
  committed-halt-record template (adr-2026-08-23 D8) rather than inventing a channel.
- **No session resume.** Every guided session cold-starts with rendered context; the capability is
  structurally absent on both providers (adr-2026-07-27-cold-start-within-step-retries §5).
- **No stream consumer when interactive** (adr-2026-08-25 D4) — honoured, and it is the stated
  reason exit never means resolved.
- **Non-autonomy.** The monitor never starts, stops, restarts, attaches to, or supervises a daemon,
  and writes no daemon-supervision state (adr-005, adr-2026-06-29 sub-decision 2).
- **Operator identity** resolves through the existing machine-scoped path; no second notion is
  introduced (adr-2026-07-01).

**Two apparent conflicts, both resolved rather than waived.**

*Always-on process.* adr-011 D5 records that "the harness supervises no always-on process". This
design does not contradict it. That decision governs what the *harness* supervises; the monitor is a
foreground process the operator starts and stops at their own terminal, with no pidfile, no
supervision, no restart, and no daemon dependency on its being up. The existing follow-mode log
command is the precedent for exactly this shape. The decision's substance — the harness does not
acquire a background process to keep alive — is preserved intact.

*Fleet plus follow.* Following several projects' logs at once is refused today, and that refusal is
sound: interleaving N live streams into one terminal produces unreadable output. This design does
not do that. It presents one item at a time from a merged, ordered queue; cross-project breadth
affects membership, never concurrent output. The refusal's reasoning does not reach this design.

**Diagram accuracy.** The architecture artifact was authored in this DECIDE pass and matches these
decisions. Its Event-Spine Decision block records the anti-polling counter-argument explicitly
rather than assuming it away; ADR D2 settles it on evidence.

## Domain Integrity

| Principle | Assessment |
|---|---|
| No primitive obsession | Halt class is already a closed union with a total classification boundary (adr-2026-07-28); the priority band is already an enum. **Condition C3** applies: the deferral key must be a named domain type carrying project, feature, and halt identity — not a concatenated string, which would make a key-format change a silent data migration. |
| Parse, don't validate | Halt class is read and normalised once, at the single tolerant reader in the halt-marker module. Membership filtering consumes the parsed class thereafter. |
| Invalid states unrepresentable | The queue holds no status field at all — membership is derived, so "offered", "in progress", and "resolved" cannot disagree with reality because they are not stored. This is the design's main domain-integrity strength. |
| Semantic types | The deferral record answers "which halt did the operator defer", not "what string did we write"; C3 pins this. |
| Exhaustive matching | Halt-class handling must match exhaustively over the existing union with no catch-all. `unclassified` is already a member of that union and a member of the set requiring human action — it must be offered, never silently filtered as unrecognised (FR-17). |

No production dependency-injection default uses an in-memory store for stateful data: the only
durable state is the deferral record on the filesystem.

## Wiring Surface

Design-time commitments; no `file:line` is claimed, since the code does not exist.

| New production surface | Where it is called from in production |
|---|---|
| Monitor command detector and dispatcher (new module) | The hand-rolled detect/dispatch chain in the engine entry point, placed before the daemon block so a bare non-flag token cannot fall through to a daemon launch, and lazily imported because it reaches the provider launch path. |
| Monitor command help declaration | The existing Commander program builder, so the verb appears in the generated full help reference. |
| Cross-project halt enumeration | Called by the monitor's resolution pass, over the registry reader the status command already uses; per-project error boundaries follow the existing fleet helper's per-repo try/catch shape. |
| Halt class on halted entries | Produced by the existing state scan; consumed by the monitor's membership filter and by the operator-facing item display. |
| Deferral record module (new) | Written by the monitor's skip path, read by its ordering pass, cleared when a deferral's halt identity no longer matches. Sole writer is the monitor. |
| Provider-agnostic interactive launch seam (new) | Called by the monitor's session step. The existing composer launch path is the second intended caller once generalised; whether that migration lands in this feature or a follow-up is a plan decision, not an architecture one. |
| New `ConductorEvent` members for queue transitions | Emitted by the monitor's queue; consumed by the existing persister and sink registry, which the type system forces to declare each new member. |
| Documentation entries | The CLI reference, the repository README, and the engine README, per the established new-verb docs obligation. |

**Early overlap scan (advisory, non-blocking).** `origin/spec/daemon-self-host-guardrails` has
unmerged changes to `daemon-dashboard.ts` and `halt-marker.ts` — both files this feature must
extend. This does not block the verdict; it means the plan should avoid deep restructuring of either
file and prefer additive extension, and the build should expect a rebase against that branch.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The unmarked-session bypass is reused to grant authority to an engine-dispatched session, eroding the guard | Security | Low | **High** | ADR D4 makes the seam reachable only from a foreground operator command with an attached terminal, enforced structurally at the seam. Condition C1 requires a test that pins this rather than prose asserting it. |
| A stale deferral suppresses a genuinely new halt on the same feature | Data | Medium | **High** | ADR D4 keys deferrals on halt identity and fails toward re-offering. Condition C3 pins the key as a domain type. |
| The second provider's interactive invocation form does not fit the generalised seam | Technical | Medium | Medium | Only one provider's form is demonstrated by the existing precedent; the other's REPL is documented as a bounded one-shot with a piped prompt. Condition C2 requires the seam to be proven against both providers before the feature is considered delivered. |
| The guided session trips the self-host live boundary and halts a running build | Integration | Low | **High** | ADR D5 confines the session to the halted feature's worktree, an already-excluded path. The exclusion list is not widened. |
| Priority resolution makes each pass slow or rate-limited across many projects | Performance | Medium | Medium | Reuse the existing resolver's in-process cache and attempted-reference suppression; never re-fetch per pass. Ordering degrades to stable fallback on outage rather than blocking. |
| Two monitors over the same repo double-offer the same halt, or race on the deferral record | Data | Low | Medium | Membership is derived, so a double offer is a redundant prompt, not corruption. The deferral record needs an atomic replace; no second reusable recovery mutex may be invented (adr-2026-09-11 D1). |
| The new verb trips the release migration gate | Integration | Medium | Medium | Condition C4: the implementation must not edit the legacy CLI shim, following the proven scoped-verb precedent that shipped a new verb with neither a migration block nor a waiver. |
| Polling interval delays noticing a halt | Performance | High | Low | Accepted. The interval is a liveness floor for noticing only; every consumer re-derives membership before acting. The alternative — event-driven detection — would today miss halts outright (ADR D2). |

## ADRs Created

Two, both drafted in this pass and pending operator approval; neither is authoritative until
approved.

1. **adr-2026-09-20-halt-resolution-queue-derived-from-markers** — settles OQ-2, OQ-3, OQ-4. The
   queue is derived from halt markers and stores no membership; only operator deferrals persist,
   keyed by halt identity and failing toward re-offering; ordering reuses the existing priority band
   with a stable tie-break and degrades without emptying; transitions ride the spine; no durable
   queue artifact ships now, and what would justify one is recorded.
2. **adr-2026-09-20-operator-launched-sessions-retain-conductor-authority** — settles OQ-1 and OQ-6.
   The daemon-session marker's subject is engine-dispatched sessions; an operator-launched session is
   not one and retains authority. The exemption list is not widened and the guard is not weakened. A
   provider-agnostic seam is the sole unmarked spawn point, reachable only from a foreground operator
   command with a terminal attached. The session runs in the halted feature's worktree, cold-starts
   with rendered context, and its exit is never read as resolution.

**Reuse rather than duplication.** OQ-5 is resolved by citing adr-011 D5 and the foreground-command
precedent; OQ-6 folds into the second ADR rather than becoming a third; OQ-7 is bookkeeping, resolved
below. No third ADR was created, and the governing decisions listed in each ADR's reuse check are
applied rather than restated.

**OQ-7 — relationship to #355.** This feature **implements** #355 rather than superseding it: #355 is
"productize the operator-local halt monitor", and this is that productization with the unattended
issue-filing half deliberately dropped per operator decision. The operator-local prototype is not
deleted by this feature — it lives outside the repository and cannot be removed by a repository
change. Once this ships, the prototype is superseded in practice and the operator can retire it; the
existing halt-issue reconciliation it invoked continues to run on the monitor's cycle unchanged
(FR-26). The prototype's companion auto-rekick script is out of scope and stays superseded by the
shipped progress-aware retry work it predates.

## Conditions

Tracked in the plan; checked by the evaluator at code review; unmet at finish is blocking.

- **C1 — Pin the launcher's reachability invariant with a test, not prose.** ADR D4's restriction —
  the unmarked launch seam is reachable only from a foreground operator command with an attached
  terminal — is the single thing preventing this feature from becoming a way to grant conductor
  authority to engine-dispatched sessions. It must be enforced structurally and proven by a test
  that fails if the seam becomes reachable from the daemon, a step runner, or a non-interactive
  invocation. A documented expectation does not satisfy this condition.
- **C2 — Prove the launch seam against both providers.** The seam is not delivered while only one
  provider's interactive form is exercised. Per the repository's test-process-isolation rule, use a
  mocked provider boundary and verify the production adapter reaches the mock before exercising any
  real spawn; a configured mock alone is not proof of isolation.
- **C3 — The deferral key is a named domain type.** It carries project, feature, and halt identity as
  structured fields. A concatenated string key is refused: it would turn a key-format change into a
  silent data migration and make the fail-toward-re-offering behaviour of ADR D4 unverifiable.
- **C4 — Do not edit the legacy CLI shim.** The new verb lands under the engine and its existing
  dispatch, following the proven scoped-verb precedent, so the release gate's breaking-surface
  classifier is not triggered. If any change to that shim becomes genuinely necessary, it needs a
  real migration block — a waiver is not the right instrument for a behavioural CLI change.
- **C5 — Halt-class handling is exhaustive, and `unclassified` is offered.** No catch-all default over
  the halt-class union. A halt whose class is unrecognised is presented with its class stated as
  undetermined (FR-17), never filtered out of the queue.
- **C6 — Documentation ships with the verb.** The CLI reference, the repository README, and the engine
  README, per the established new-verb docs obligation.
- **C7 — Reuse the existing priority resolver, including its cache and outage behaviour.** Do not
  introduce a second priority fetch path, and do not let an unresolvable priority empty or block the
  queue.
