# ADR: Engine-managed build_review rubric branches with skill-owned judgement policy

**Date:** 2026-08-13
**Status:** APPROVED
**Approved:** Operator-approved 2026-08-13
**Deciders:** James Stoup (operator) and architecture review for issue #1542
**Supersedes:** `adr-2026-07-07-build-review-judgement-gate`
**Partially supersedes:** `adr-2026-07-21-completeness-as-build-review-rubric` for unconditional
Completeness enablement and single-dispatch topology; `adr-2026-08-11-wiring-judged-in-build-review`
for single-dispatch topology and the no-new-dispatch cost claim. Their rubric meanings remain
approved.
**Conflict resolution:** Operator-approved 2026-08-13
**Preserves:** the public gate placement, input-starvation trust boundary, fail-closed verdict,
and dedicated failure routing established by the superseded decision

## Context

`build_review` began as one engine-internal, one-shot grader because a normal custom step or skill
could not enforce its trust boundary: the engine had to select the exact diff and approved plan,
exclude maker narrative, require a fresh session, validate one exact verdict, and own kickback
routing. That reason still holds.

The combined grader now evaluates five independently useful concerns. One provider/model/retry
policy applies to all five, one slow rubric sets the entire session's latency, and a fresh grader
rejudges every concern together. Issue #1542 requires independent configuration and concurrent
execution without turning the five rubrics into public lifecycle steps or handing deterministic
orchestration to an LLM coordinator.

Existing approved architecture supplies most prerequisites:

- `adr-2026-07-10-concurrent-group-core` provides a capped semaphore, isolated branch sessions,
  retry integration, attribution, and a single-writer join.
- `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope` requires branch-, step-, and
  provider-local fresh sessions and preserves provider-native fallback behavior.
- `adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation` provides candidate-local skill
  syntax for Claude and Codex.

The current `runGroupBranch` assumes each member name is a `StepName`, while a rubric is not a
lifecycle step. Reusing it through casts or fabricated step names would pollute state, model tables,
and step exhaustiveness. The reusable boundary is the group core's semaphore, session, outcome,
rate-limit, and attribution machinery behind a rubric-specific dispatch adapter.

## Options Considered

### Option A: Retain one engine-inline grader and extend its result schema

- **Pros:** Smallest change; preserves the current one-call cost and execution path.
- **Cons:** Cannot assign different providers, models, ladders, or retries per rubric; keeps policy
  coupled to engine source; one failure still re-runs every rubric.

### Option B: Invoke one build-review skill that creates its own subagents

- **Pros:** The coordinator prompt could evolve without engine changes; subagents appear concise.
- **Cons:** Provider child-agent lifecycle is not exposed to engine retry, rate-limit, cost, session,
  or event accounting; provider parity depends on prompt discipline; the coordinator can vary the
  join and evidence supplied to children.

### Option C: Engine-managed fan-out to five shipped rubric skills

- **Pros:** Independent execution policies and observability; deterministic evidence and join;
  provider-neutral skills; established concurrency and provider seams remain authoritative.
- **Cons:** Up to five model calls per lap; requires a typed auxiliary branch adapter and five skill
  contracts; the shared provider and event surfaces broaden the implementation diff.

## Decision

Choose **Option C**.

### 1. Preserve one public engine gate

`build_review` remains one `StepName`, one completion predicate, and one failure-routing source.
Tautology, Scope, Root Cause, Completeness, and Wiring are internal rubric identifiers, never new
top-level steps and never synthetic `StepName` casts. Whole-gate disablement remains separate from
rubric membership.

The engine retains exclusive ownership of evidence assembly, session dispatch, result validation,
finding identity, disposition application, outer verdict, and routing. A skill owns only the
judgement instructions for one rubric.

### 2. Freeze one immutable source snapshot and bounded rubric projections

Before fan-out, the engine resolves the fresh base once and assembles one versioned source snapshot:
feature identity, lap ID, base and HEAD, diff, approved plan, current code-valid `test_suite` PASS,
scoped-test contract, repair context, accepted scope widenings, configured entry points, and removal
evidence. Every enabled branch is derived from that same frozen source. The snapshot excludes maker
transcript, summary, task-status narrative, prior grader prose, and accepted dispositions.

The engine then derives one closed, versioned input projection per rubric. A projection contains
all and only the source fields that rubric's skill contract permits it to judge. The skill receives
the projection, not a path through which it can read additional source-snapshot fields. This keeps
all branches bound to one feature change while making cache invalidation mechanically complete: if
a skill is allowed to depend on a field, that field participates in its projection digest.

The lap ID binds to the immutable input digest rather than a mutable filename timestamp. Branch
results must repeat the lap ID and snapshot digest; a mismatch is an infrastructure-shaped failure.

### 3. Reuse green test evidence and preflight only Tautology's RED side

The preceding `test_suite` gate is the authoritative proof that the current HEAD is green.
`build_review` does not repeat the same changed-test run on HEAD. Before dispatching Tautology, the
engine owns one missing counterfactual: keep the changed tests, substitute the changed production
code's merge-base form, and execute the scoped tests in an isolated disposable checkout. The
preflight records the command, source identities, exit classification, and bounded output as typed
evidence in the Tautology projection.

The experiment never mutates the feature worktree or live root checkout. An empty applicable test
set follows the existing closed Tautology exception policy; an inability to materialize the
checkout, execute the scoped command, or cleanly finalize the experiment is an infrastructure
failure. A successful test command in the reverted-production checkout is evidence that the changed
tests stayed green and therefore blocks Tautology unless an approved exception applies. A normal
test failure is the expected RED evidence and is not an infrastructure failure.

The engine derives changed-test selectors from the diff's closed affected-test path rules and forms
the reverted-production patch from the remaining changed production paths. An unclassifiable or
empty selector set follows the existing explicit exception/fail-closed rules; it never widens to the
aggregate suite. The disposable Git worktree is nested below the configured scoped-test working
directory's ignored `.pipeline/build-review-preflight/` path so ordinary upward dependency discovery
can reuse the already-installed environment without copying it or touching the live tree.

Preflight evidence has its own bounded exact-input cache because the Tautology rubric projection
cannot be hashed until that evidence exists. Its key includes merge base, changed-test selectors and
content, the reverted-production patch, scoped-run configuration, and current green-proof identity.
Only completed `red`, `stayed-green`, or approved-exception evidence is reusable; infrastructure
failures never cache. A cache hit still validates current `test_suite` proof and emits a preflight
cache-hit event.

### 4. Make rubric policy shipped and provider-agnostic

Add five consumer-facing skills under the shipped `skills/` catalog:

- `build-review-tautology`
- `build-review-scope`
- `build-review-root-cause`
- `build-review-completeness`
- `build-review-wiring`

Each skill declares a versioned, rubric-specific result contract. The scope-check verdict is
consumer-facing and provider-agnostic: installed projects execute these policies, while host syntax
continues through the existing skill-invocation adapter.

### 5. Resolve execution policy independently per rubric

The `build_review` config gains `maxParallel` and a closed `rubrics` map. Every rubric defaults to
enabled and inherits the outer `build_review` provider-native execution policy. A rubric may
independently override:

- ordered `llm_provider` candidates;
- model and reasoning effort;
- `model_fallback_ladder`;
- `max_retries`; and
- retry `escalate` behavior.

`maxParallel` defaults to **5** and is clamped to the enabled member count. An enabled gate with no
enabled rubrics is a configuration error. A disabled gate dispatches no rubric and does not publish
an empty successful join.

Legacy `build_review.enabled` and `perTaskFloor` parsing retains its tolerant per-key fallback.
The new `maxParallel` and `rubrics` subtree is fail-closed: invalid types, ranges, rubric IDs, or
execution-policy values reject configuration before any rubric dispatch. This deliberately narrows
the older whole-block totality contract rather than silently substituting an execution policy the
operator did not select.

Rubric policy feeds the existing provider-aware candidate executor. Cross-provider fallback
re-resolves provider-native defaults and starts a fresh provider session exactly as the governing
provider ADR requires; no rubric-local provider stack or availability cache is introduced.

### 6. Reuse the group core without falsifying step identity

Extend the group core with a typed auxiliary-dispatch callback that accepts a string member ID and
an execution policy. It reuses capped scheduling, detached provider sessions, retry/rate-limit
handling, actual-provider attribution, and exhaustive branch outcomes. It does not write synthetic
conduct-state keys and does not cast rubric IDs to `StepName`.

The build-review coordinator owns a rubric-specific outcome union:

- `skipped` — deterministically not dispatched, with the closed reason `disabled` or, for Wiring,
  `missing-entry-points` when its existing production-entry premise is absent;
- `judged` — a valid result, containing zero or more findings; or
- `infrastructure-failure` — no valid result after the branch's own recovery policy.

An infrastructure failure is never converted to a content finding, skip, or pass.
A skip is never converted to a pass. The Wiring prerequisite skip preserves the approved
not-judged behavior, remains visible as reduced coverage, and is excluded from judged-rate
denominators. Completeness remains default-enabled but may now be explicitly disabled; this is the
operator-approved escape hatch that partially supersedes its former unconditionality.

### 7. Short-circuit unchanged rubric judgements without reusing stale verdicts

Every closed rubric descriptor declares content-addressed caching. The cache key combines the
rubric ID, rubric contract and projection versions, the canonical projection digest, and the fully
resolved provider/model/effort/fallback/retry policy fingerprint. Skips are computed before the
cache and provider layers. Infrastructure failures and malformed or unsupported cache entries are
never reusable.

A cache hit reuses only a previously validated semantic `judged` result. The coordinator stamps it
into the current lap's rubric artifact with its current lap and snapshot identities plus explicit
cache provenance, emits a cache-hit event, and passes it through the same identity validation and
join as a fresh result. It never reuses a prior aggregate verdict or prior artifact freshness.
Changing dispositions leaves raw projections unchanged, so an accepted finding can be rejoined
without spending five more grading calls. Changing any field visible to a rubric, its contract, or
its resolved execution policy invalidates that rubric deterministically. Cache state, including
Tautology preflight evidence, is bounded feature-scoped durable control state under
`.pipeline/build-review/cache/`, not a telemetry ledger.

### 8. Keep branch writes disjoint and join once

Each session writes only `.pipeline/build-review/«lap»/«rubric».json`. The path is supplied by the
engine and validated with the lap and rubric identity. The coordinator waits for every enabled
branch, validates each result, then becomes the sole writer of the backward-compatible aggregate
`.pipeline/build-review.json`.

The aggregate retains the existing top-level `verdict`, `reasons`, `findings`, `rubric`, and
`codeStamp` compatibility fields while adding lap identity, per-rubric raw results, skips,
infrastructure failures, and stable finding payloads. Legacy verdicts parse only under their
existing fail-closed rules and cannot acquire dispositions.

The raw aggregate is formed before accepted dispositions are consulted. Effective gate completion
is then derived deterministically from the raw aggregate plus the disposition store defined by
`adr-2026-08-13-stable-build-review-finding-dispositions`. The reducer accepts a typed set of
post-judgement resolution inputs even though v1 supplies only operator dispositions. This preserves
an integration seam for the operator-identified future Tautology/Scope claim-or-bypass spec without
defining, authorizing, matching, or applying those future records here. Neither present dispositions
nor future resolution inputs may appear in rubric projections or convert a raw finding to raw PASS.

### 9. Extend existing observability and publication paths

Rubric start, result, skip, cache hit, infrastructure failure, and effective outer-verdict
occurrences extend the `ConductorEvent` union and existing sink declarations. Standard reporting
derives laps-to-pass, raw failure rate per rubric, skip coverage, and cache usage from those events.
Accepted risk remains visibly different from a raw grader pass.

Publication reads the authoritative disposition state and deterministically renders its accepted
risk section into the retained PR and shipped record; it does not ask a grader or finish agent to
reconstruct acceptance from prose.

## Claim Verification

| Claim | Confidence | Basis |
|---|---:|---|
| Current `build_review` is one engine-assembled, one-shot grader writing one aggregate artifact | 100% | Verified in `step-runners.ts`, `build-review-prompt.ts`, and `artifacts.ts` |
| The group core supplies capped scheduling and branch-local sessions but its current dispatched member path assumes `StepName` | 100% | Verified in `group-core.ts` |
| Provider-aware execution already covers judgement and concurrent paths with provider-local fallback/session rules | 98% | Approved provider ADRs plus current resolver/provider-execution wiring |
| Candidate-local skill rendering supports Claude and Codex without transport-level prompt rewriting | 100% | Verified in `skill-invocation.ts` and its governing ADR |
| Five simultaneous rubric calls need no new package, service, port, database, or shared worktree resource | 98% | Current Node/TypeScript semaphore and provider architecture; only provider concurrency increases |
| The current prompt reruns changed tests on HEAD but asks the grader to infer mutation sensitivity rather than mechanically executing the reverted-production RED side | 100% | Verified in `build-review-prompt.ts` and the existing scoped-run boundary |

Operator-approved assumptions: engine-managed fan-out, five default-enabled rubrics, a default
maximum of five sessions, independent policy ladders, one public gate, and no grader-owned
subagents. No unconfirmed load-bearing assumption remains.

## Consequences

### Positive

- Rubrics can evolve, disable, and choose execution policies independently without changing the
  public lifecycle topology.
- Evidence isolation and the final verdict remain machinery-enforced.
- Unchanged rubric judgements and disposition-only laps do not spend repeat model calls.
- The existing `test_suite` PASS is reused instead of paying for a redundant green-side test run.
- Raw grader quality remains measurable even when the operator accepts a finding.
- Future rubric additions have a registry and result contract instead of requiring another inline
  all-in-one prompt rewrite.
- A future Tautology/Scope claim system can reference typed finding anchors and compose after raw
  judgement without forcing claim policy into rubric skills or cache identity.

### Negative

- A cache-cold review can rise from one to five model calls per review lap.
- The Tautology RED preflight adds an isolated scoped test execution and temporary-checkout lifecycle.
- Shared engine/config/provider files have high overlap with other active work and will require
  narrow modules plus rebase discipline.
- A slow enabled rubric still delays the outer join.
- Five shipped skills add registration, model-table, installation, and documentation obligations.

### Follow-up Actions

- [ ] Add the five shipped skills and all catalog/model-table registrations.
- [ ] Add rubric config validation and default-five resolution.
- [ ] Add the typed auxiliary group branch adapter and build-review coordinator.
- [ ] Add the isolated Tautology RED preflight and reuse current `test_suite` PASS evidence.
- [ ] Split the inline prompt into rubric-owned contracts over closed input projections.
- [ ] Add bounded per-rubric semantic-result caching and current-lap cache provenance.
- [ ] Add write-disjoint result validation and the backward-compatible aggregate join.
- [ ] Add event, report, publication, documentation, and migration coverage.
