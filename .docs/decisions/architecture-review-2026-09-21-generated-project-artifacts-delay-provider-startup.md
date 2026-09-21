# Architecture Review: Generated project artifacts delay provider startup (#1219)

**Date:** 2026-09-21
**Mode:** pre-stories, lightweight (Medium tier — §2 Feasibility and §4 Alignment only)
**Track:** technical
**Stories reviewed:** none yet — this review runs before `/stories`, against the explore output
and the approved design in `.docs/architecture/generated-project-artifacts-delay-provider-startup.md`
**ADR corpus swept:** repo_wide — all 592 files in `.docs/decisions/`, in four non-overlapping
slices
**Verdict:** APPROVED WITH CONDITIONS
**Verdict history:** BLOCKED on first pass (2026-09-21); operator selected resolution R-1 the same
day and the review was re-run against the narrowed scope, per §9. The blocking findings B-1 and
B-2 below are retained as the record of why the scope narrowed — they are resolved by removal of
the offending scope, not by rebuttal.

## Summary

The declaration half of this design re-opens a question an APPROVED ADR closed, and the latency
premise that motivates it does not survive measurement. The diagnostic half is sound and violates
nothing. A human must choose the resolution; this review does not auto-resolve it.

## Feasibility

The mechanism is buildable with no new dependency and very little new plumbing.

| Check | Assessment |
|---|---|
| Stack compatibility | **Clear.** No new package. `live-boundary.ts:330` already shells to `git` via the module's own `execFile` promisified at `:9`, so the proof uses an in-module precedent rather than a new seam. |
| Prerequisites | **Clear.** `resolveSelfHostConfig(this.config)` is already bound as `sh` at `conductor.ts:5957` and consumed at `:6122`, four lines after the fingerprint call at `:6115`. A declared list reaches the call site with zero new plumbing. |
| Integration surface | **Moderate.** `types/config.ts` (`HarnessSelfHostConfig`, `:371`), `engine/config.ts` (`:1401` unknown-key branch), `engine/resolved-config.ts` (`ResolvedSelfHostConfig`, `:611`), `self-host/live-boundary.ts`, `types/events.ts`, `engine/event-sinks.ts`. Six modules, all additive. |
| Data implications | None. No schema, no migration, no persisted state. |
| Performance risk | **Inverted — see Alignment.** The change is motivated by a latency claim that measurement does not support. |
| Worktree isolation | **Clear.** No ports, services, or shared mutable state. `Surface.exclude` already exists on the internal `Surface` interface (`live-boundary.ts:14`), so storing the proven set needs no type change. |

**Measured cost of the thing being optimized.** I replicated `manifest()`'s walk-and-hash over the
live checkout with the current exclusion set (`LIVE_CHECKOUT_VOLATILE` plus the `node_modules`
basename), warm cache:

| Configuration | Files | Bytes | Walk | Total |
|---|---|---|---|---|
| Including `src/conductor/dist-versions` | 6,391 | 100.7 MiB | 64 ms | **410 ms** |
| Excluding `src/conductor/dist-versions` | 6,059 | 50.0 MiB | 94 ms | **390 ms** |

The generated tree this feature exists to make declarable accounts for roughly **20 ms**.

## Alignment

### A-1 — BLOCKING: the design contradicts an APPROVED ADR

`.docs/decisions/adr-2026-08-17-structural-live-checkout-containment.md` is **APPROVED** and owns
the exact mechanism this design changes. Decision 4, verbatim:

> **`verifyLiveBoundary` consumes the verdict, and nothing else changes.** … `fingerprintLiveBoundary`,
> `LIVE_CHECKOUT_VOLATILE`, `diffManifests`, `describeDiff`, and `classifyLiveCheckoutDiff` are
> unchanged, and **no exclusion is added**.

Its rejected-alternatives section states the standing position, verbatim (`:26-29`):

> **Excluding the path is not available.** … Widening the exclusion list blinds the guard to the
> exact leak it exists to catch, and #1301 rules it out explicitly.

That ADR chose structural containment (`bwrap`) *instead of* exclusion widening, on principle, for
this precise guard. `adr-2026-08-09-worktree-local-provider-scratch` (APPROVED) independently
treats exclusion widening as categorically unavailable, and selected its own scratch-directory
location specifically to avoid ever needing one. `CLAUDE.md` restates the same prohibition in prose
("Do NOT 'fix' this by widening the exclusion list").

A fair reading distinguishes two things: D4's literal sentence is a scope statement about that
ADR's own diff, whereas the rejected-alternatives text is a standing architectural position. Either
way, a project-declarable exclusion list re-opens a question that ADR decided. The design's novelty
— a double-predicate proof re-verified every fingerprint, rather than a static list — is a
genuinely different risk profile and may well be the right answer. It is not, however, a change
this review may make on its own: per §9 an APPROVED-ADR conflict is resolved by the operator, by
code change or by a human-approved superseding or amending ADR, never silently.

### A-2 — BLOCKING: the premise does not survive measurement

The intake attributes a 17m21s pre-provider interval on 2026-07-31 to the fingerprint recursively
reading a 68 MiB, 561-file generated tree. Three findings contradict that attribution:

- The equivalent tree today is hashed in ~20 ms (table above). Even allowing a cold page cache and
  the 2026-07-31 tree's larger size, this is three orders of magnitude short of 17 minutes.
- `node_modules` was excluded on **2026-07-29** (`6d8ed63ff`), two days *before* the incident, so
  the dependency tree was not being walked.
- The provider home's `projects/` subtree — 2.3 GiB of the 2.4 GiB live `~/.claude` today — was
  excluded on **2026-07-26** (`6eee66018`), five days before the incident.

So the two plausible bulk-cost candidates were already excluded when the stall was observed, and
the tree that was *not* excluded is measurably trivial. The 17 minutes is therefore **unattributed**:
it lies somewhere in the window between step entry and provider return, which also contains
provider-home provisioning and (today) the containment probe. Confidence that the live-checkout
fingerprint was *not* the dominant term: **~92% (verified by measurement and git history)**.

This matters beyond the premise. PR #1217 already landed the `dist-versions` exclusion, so the
concrete symptom that prompted the issue is mitigated on this repo; what remains is the
generalization ("other projects cannot declare equivalent safe exclusions"), and that
generalization is now asking to spend an architectural decision to recover an unmeasured cost.

### A-3 — The diagnostic half is sound and unblocked

The issue's own desired outcome — "Provider-start diagnostics expose the time spent constructing
the safety fingerprint so pre-provider latency is attributable" — is the one deliverable that
would have prevented this misdiagnosis, and it conflicts with nothing in the corpus. It is also a
precondition for grading any future latency claim, including A-2's open question.

### A-4 — Mechanical obligations for the event variant (non-blocking, applies to any resolution)

`EVENT_SINKS` (`src/conductor/src/engine/event-sinks.ts:12`) is typed
`Record<ConductorEvent['type'], SinkDeclaration>` per `adr-2026-07-26-event-sink-registry-exhaustiveness`
(APPROVED), so a new union member **fails compilation** until it declares its sinks. Verified: the
registry exists at that path. `adr-2026-07-10-intra-step-build-progress-events` (APPROVED) adds the
render-path obligations. Both are ordinary, compile-enforced, and no obstacle.

One weaker signal, worth a line in the plan rather than a condition: recent precedent
(`architecture-review-2026-09-09-export-the-telemetry-dimensions-…`) prefers additive fields on an
existing event over a new variant where one already carries the right shape. A new variant still
looks correct here — no existing event spans the fingerprint interval — but the plan should say so
explicitly rather than assume it.

### A-5 — Declaration scope is narrower than "any consumer project" (non-blocking)

`adr-2026-07-27-project-config-scaffolder` D6 excludes `harness_self_host` from ordinary consumer
scaffolds: it is a self-hosting-repo block. The issue's framing ("other projects cannot declare
equivalent safe exclusions") therefore covers only projects that themselves self-host the engine,
not consumer projects generally. Any story wording must not overstate the audience.

### A-6 — The live checkout is not always the project root (non-blocking, but a real correctness trap)

`conductor.ts:6110` fingerprints `installed.root` — the installed main checkout — falling back to
`this.projectRoot` only when resolution is not `ok`, and `deriveBindSet(liveCheckout, this.projectRoot)`
at `:6121` treats the two as potentially different. A declaration read from the *project's* config
must therefore be proved against, and applied to, the checkout actually being fingerprinted. Under
`activation: force_on` these can diverge. Any implementation must resolve this explicitly rather
than assume they coincide.

### A-7 — Unverified obligation

`adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` D4 requires every documented
config key to appear in a total `Record<DocumentedConfigKey, ConsumerDeclaration>` registry. I could
not find that registry in source (no match for `DocumentedConfigKey`, `ConsumerDeclaration`,
`CONFIG_KEY`, or a comparable test). **Unverified — ~85% confident it is unimplemented.** If it does
exist under another name, a new key must register there. Recorded rather than asserted.

## Wiring Surface

Design-time commitments, per new production surface.

**Resolved 2026-09-21 (R-1):** rows 1-3 are **withdrawn** with the declaration mechanism and are
retained only for the re-triage of #1219's remaining half. Row 4 is the sole production surface
this feature introduces, joined by one measurement return value:

| New surface (in scope) | Where it is called from in production |
|---|---|
| `self_host_boundary_fingerprint` event variant | Emitted from `conductor.ts` via `this.events.emit`, beside the existing `self_host_containment_verdict` emit at `:6156-6159`; declared in `EVENT_SINKS` (`engine/event-sinks.ts:12`) for persist + render. |
| `manifest()` / `fingerprintLiveBoundary` measurement return | Consumed at the existing `fingerprintLiveBoundary` call site, `conductor.ts:6115`, which already binds the snapshot. |

Withdrawn rows, retained for the record:

| New surface | Where it is called from in production |
|---|---|
| `harness_self_host.<exclusion key>` config key | Parsed by `validateConfig` in `engine/config.ts` (the `harness_self_host` branch at `:1401`); surfaced through `resolveSelfHostConfig` in `engine/resolved-config.ts:657` onto `ResolvedSelfHostConfig`. |
| Declaration-proof function (new, in `self-host/live-boundary.ts`) | Invoked by `fingerprintLiveBoundary` before it builds the live-checkout surface, and again by `verifyLiveBoundary` as the re-proof guard. Both are already called from `conductor.ts:6115` and `:6150`. |
| `fingerprintLiveBoundary` new parameter | Supplied at `conductor.ts:6115` from `sh` (`resolveSelfHostConfig`), already bound at `:5957`. |
| `self_host_boundary_fingerprint` event variant | Emitted from `conductor.ts` via `this.events.emit`, the same emitter used for `self_host_containment_verdict` at `:6156-6159`; declared in `EVENT_SINKS` (`engine/event-sinks.ts:12`) for persist + render. |

**Early overlap scan:** `ai-conductor overlap-scan` over these paths reports *"No overlap detected;
no open blockers."* Advisory only.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A declared path later begins shadowing tracked source, silently blinding the guard | Security | Low | **High** | The double-predicate proof re-runs every fingerprint and fails closed; this is the design's central safety claim and the reason it is not a static list |
| Exclusion capability lands, and the real 17-minute cost is elsewhere and persists | Technical | **High** | Medium | Land the duration signal first and attribute the interval before spending an ADR on exclusions |
| `git` indeterminacy turns into a new false-halt class on the dispatch path | Technical | Medium | Medium | Fail-closed by design; bound the invocation and name the path in the halt reason, matching `classifyLiveCheckoutDiff`'s posture |
| Declaration applied to a checkout it was not written for (A-6) | Technical | Medium | High | Resolve `liveCheckout` vs `projectRoot` explicitly before applying any declaration |

## Blocking Issues

**B-1 — APPROVED-ADR conflict (A-1).** `adr-2026-08-17-structural-live-checkout-containment` D4 and
its rejected-alternatives section rule out widening the live-checkout exclusion list;
`adr-2026-08-09-worktree-local-provider-scratch` concurs. The declaration half of this design does
exactly that.

**B-2 — Falsified premise (A-2).** The measured cost of the generated tree is ~20 ms, not minutes,
and the two bulk-cost candidates were already excluded before the incident. The latency
justification for B-1's exception does not currently exist.

Neither blocks the diagnostic half (A-3).

## Resolution Options

The operator chooses; this review does not auto-resolve.

**R-1 — Narrow the feature to the duration signal.** Ship the `ConductorEvent` variant and the
provider-start attribution; drop the declaration mechanism from this feature. No ADR conflict, no
falsified premise, and it produces the evidence needed to decide B-1 properly. Cost: #1219's
declaration outcomes go unmet for now and the issue stays open, narrowed.
*Trade-off:* smallest scope, highest confidence, defers the generalization.

**R-2 — Keep the full scope and amend the governing ADR.** Amend
`adr-2026-08-17-structural-live-checkout-containment` with numbered decisions recording that a
proof-backed, re-verified declaration is a materially different risk profile from the static
exclusion widening it rejected. Requires human ADR approval before stories.
*Trade-off:* delivers #1219 as filed, but spends an architectural decision against an unmeasured
benefit (B-2 unresolved), and widens the guard's configurable surface.

**R-3 — Close #1219 as mitigated.** PR #1217 excluded the tree; containment (#1301) changed the
failure mode; the measured cost is negligible.
*Trade-off:* cheapest, but leaves no attribution for the original 17 minutes and no diagnostic for
the next occurrence.

**Recommendation: R-1.** It is the only option whose value does not depend on the unverified claim
in B-2, it satisfies the issue's diagnostic outcome exactly, and it makes B-1 a decision on
evidence rather than on assumption. If the duration signal later shows fingerprinting is genuinely
expensive on some checkout, R-2 becomes a well-founded amendment instead of a speculative one.

## Resolution (operator, 2026-09-21)

**R-1 selected.** The declarable-exclusion mechanism is withdrawn from this feature; the
fingerprint-duration signal proceeds alone. Issue #1219 remains open, narrowed to its remaining
declaration outcomes, to be re-triaged once the emitted duration attributes the pre-provider
interval.

Both blockers are cleared by scope removal rather than by argument:

- **B-1 cleared.** Nothing is added to `LIVE_CHECKOUT_VOLATILE` and no exclusion becomes
  declarable, so `adr-2026-08-17-structural-live-checkout-containment` D4 is untouched. No ADR
  amendment is required, and none is authored.
- **B-2 cleared.** The narrowed feature makes no latency claim. Its deliverable is attribution,
  which is the evidence B-2 found missing.

Findings A-5 (declaration audience), A-6 (`liveCheckout` vs `projectRoot`), and A-7 (config-key
consumer registry) lapse with the config surface and do not apply. They are retained above for the
re-triage of #1219's remaining half.

### Conditions

**C-1 — Exhaustiveness obligations are met.** The new `ConductorEvent` member declares its sinks in
`EVENT_SINKS` (`engine/event-sinks.ts:12`) per `adr-2026-07-26-event-sink-registry-exhaustiveness`,
and its render-path wiring per `adr-2026-07-10-intra-step-build-progress-events`. Both are
compile- or test-enforced; the plan must carry them as tasks rather than assume them.

**C-2 — No story criterion asserts a latency improvement.** The measured cost of the current walk
is 410 ms; this feature makes that number visible, it does not reduce it. A criterion claiming
faster provider startup would be ungradeable and false. Acceptance is: the duration and file count
of each surface are emitted, persisted, and rendered.

**C-3 — Exclusion behaviour is pinned as unchanged.** Because the change edits a module inside the
self-host safety boundary, a test must assert that the manifest contents and exclusion sets are
byte-identical with and without the instrumentation, so the diagnostic cannot silently alter what
the guard protects.

**C-4 — The measurement seam stays off the bus.** `live-boundary.ts` returns measurements as data;
`conductor.ts` owns the single emission, beside the existing `self_host_containment_verdict` emit.
No second channel, no timestamp stamped into an artifact (`.agents/skills/event-spine/SKILL.md`).

## ADRs Created

None. The narrowed feature makes no structural decision: it adds one additive event member to an
existing union on an existing spine, which §7's structural prerequisite explicitly does not cover.
Only the withdrawn R-2 path would have required an ADR amendment.
