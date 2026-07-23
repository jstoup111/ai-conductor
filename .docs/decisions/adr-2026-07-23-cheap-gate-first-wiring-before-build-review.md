# ADR: cheap-gate-first — engine-native wiring_check, positioned before build_review

**Date:** 2026-07-23
**Status:** APPROVED
**Deciders:** engineer session (intake jstoup111/ai-conductor#879)
**Amends:** adr-2026-07-07-build-review-judgement-gate (Decision-1 positioning),
adr-2026-07-12-wiring-check-gate (Decision-1 positioning)

## Context

Constraints verified by direct read of `src/conductor/src/engine` at commit `3cc8e67b`:

- `ALL_STEPS` order is `build → build_review → wiring_check → manual_test`
  (`steps.ts:129-180`); `wiring_check.prerequisites = ['build_review']`,
  `manual_test.prerequisites = ['wiring_check']`.
- `build_review` is a one-shot LLM grader dispatch (`step-runners.ts:362-364`,
  `:853-1019`), pinned to the deepest reasoning tier
  (`model-table-metadata.ts:34-36`).
- `wiring_check`'s verdict is computed by its **completion predicate**
  (`artifacts.ts:1873-1951`) from evidence that the predicate itself computes live via
  `ctx.wiringProbe` → `computeWiringEvidence` (`conductor.ts:1005-1030`,
  `wiring-probe.ts`). Its inputs are `git diff <base>...HEAD` plus the plan's `Wired-into:`
  contracts. **Nothing in that input set is derived from build_review's verdict** —
  the ordering is pure sequencing.
- `wiring_check` has **no `skillName`** and its `STEP_PROMPTS` entry is explicitly
  documented as "Engine-native (like complexity/rebase) — … no skill dispatch. Present only
  to keep the Record<StepName, string> exhaustive." (`step-runners.ts:48-51`).
- **But** the conductor's engine-native bypass (`conductor.ts:3247-3271`) special-cases only
  `complexity`, `worktree`, `rebase` (and self-build `build`). `wiring_check` falls through
  to `this.stepRunner.run('wiring_check', …)`, which dispatches a real session on the
  `/conduct wiring-check` prompt at `model: 'sonnet'`, `effort: 'low'`, `max_retries: 3`
  (`resolved-config.ts:42,69,101`). No guard anywhere skips dispatch for a step lacking a
  `skillName` (`grep skillName` over `conductor.ts` / `step-runners.ts`: one hit, in
  `resolveGroupMembership`).
- `VALIDATION_GROUP` = `manual_test, prd_audit, architecture_review_as_built`
  (`steps.ts:310-313`). Neither reordered step is a member; the "registry builder verifies
  this positioning" note in `types/steps.ts:113-118` describes an anchor check that does not
  exist in code — `getGroupForStep` is a plain `Map` lookup.
- `.pipeline/` is gitignored, and wiring evidence stamps `head`; a HEAD move after the
  evidence write invalidates it (`artifacts.ts:892-900`).

Measured from `.daemon/daemon.log` + `.log.1` (2026-07-21 → 07-23) — outcome 4 of the intake:

- 57 completed `wiring_check` runs + 3 terminal failures; 13 gap-caused retries across 8
  distinct gap signatures; 22 `wiring-evidence.json is stale` retries.
- `build_review` wall clock: median **141 s** (mean 142, max 279) over 34 completions.
- `wiring_check` wall clock: median **118–135 s**, mean 186–243 s, **max 1157 s**.

The wiring_check timing is the falsifier: a git-diff parse plus a TypeScript import-graph
walk does not take two minutes, let alone nineteen. It is the undocumented session
dispatch. That same session's commits explain the 22 stale-evidence retries, which the
intake did not attribute.

## Options Considered

### Option A — Swap the two steps only (the intake's primary hypothesis)
- **Pros:** minimal diff; satisfies the literal wording of outcome 1 (no *grader* dispatch).
- **Cons:** leaves the larger, undocumented `wiring_check` session dispatch in place, so a
  wiring-broken HEAD still pays ~120 s of LLM time before the kickback. It also moves that
  unmetered session *earlier*, ahead of every grader — strictly worse for the wiring-clean
  path. Does not address the 22 stale-evidence retries at all.

### Option B — Make `wiring_check` engine-native only, keep the order
- **Pros:** removes the dominant per-run cost and the stale-evidence class in one edit; no
  topology change, no ADR amendments, no order-test churn.
- **Cons:** does not satisfy outcome 1 — the grader is still paid first on every
  wiring-broken HEAD (measured 8 build episodes in two days at median 141 s each).

### Option C — Concurrent execution via the validation-group machinery (intake's alternative)
- **Pros:** overlaps the two gates' wall clock.
- **Cons:** `VALIDATION_GROUP` currently has no fan-out for these steps; joining them needs
  concurrent-kickback merging (two gates can both kick back to `build` in one join) — new
  semantics for a saving that C+B already obtain deterministically. Concurrency does not
  *avoid* the grader spend, it only hides its latency. Rejected as disproportionate; the
  repo Design Principle prefers the mechanical fix.

### Option D — Keep the order; add a wiring pre-flight inside `runBuildReview()`
- **Pros:** no topology change.
- **Cons:** duplicates gate semantics inside a step runner, creates a second
  `wiring-evidence.json` write site racing the predicate's, and hides a gating verdict
  behind another step's runner (no `wiring_check` verdict event, no kickback counter, no
  `gate_blocked`). Rejected: it makes a gate invisible to the gate machinery.

### Option E (chosen) — B then A: make the gate genuinely free, then put it first

## Decision

**Option E**, as two coupled changes.

**D1 — `wiring_check` becomes genuinely engine-native.** Add `wiring_check` to the
conductor's engine-native dispatch bypass alongside `complexity` / `worktree` / `rebase`. The
step performs **no session dispatch**; its completion predicate computes evidence via the
already-wired `ctx.wiringProbe` and renders the verdict. This is not new behavior — it is
the behavior `step-runners.ts:48-51` already documents and `artifacts.ts:1873-1951` already
implements. The bypass makes the documented contract true.

Consequences of D1 that must be honored:
- The step's `model` / `effort` entries in `resolved-config.ts` become inert, exactly as
  `rebase`'s and `complexity`'s dispatch-time values are for their engine-native paths. The
  model-table row is **retained** (integrity check 5 requires a row per step; `rebase` and
  `complexity` are the precedent) with its rationale rewritten to say engine-native.
- `max_retries` still governs re-evaluation of the predicate, which remains meaningful: a
  gap-carrying evidence file is retried up to the cap before the kickback path escalates.
- The stale-evidence failure mode is expected to disappear, because nothing between the
  evidence write and the predicate's HEAD comparison can now move HEAD. This is a
  *predicted* improvement, asserted as an observable in the stories, not a load-bearing
  claim of the ordering change.

**D2 — Order becomes `build → wiring_check → build_review → manual_test`.**
- `wiring_check.prerequisites = ['build']`
- `build_review.prerequisites = ['wiring_check']`
- `manual_test.prerequisites = ['build_review']`
- Both steps keep `phase: 'BUILD'`, `enforcement: 'gating'`, `loopGate: true`,
  `skippableForTiers: []`, `isCheckpoint: false`. Positions in `ALL_STEPS` swap; nothing
  else about either `StepDefinition` changes.

**D3 — Order-derived call sites move with the topology.** The three places that hard-code
the tail order in list form are reordered to match `ALL_STEPS` (they drive event emission
order, not correctness, but drift here is exactly the kind of silent inconsistency the
repo's integrity rules exist to prevent):
- `conductor.ts:5505-5512` rebase-origin re-open target list.
- `rebase.ts:927`, `:935` post-rebase invalidation lists, and the `:897` comment.
- The wiring_check kickback block's explicit restage set (`conductor.ts:4505-4509`). Under
  the new order `build_review` is *downstream* of `wiring_check`, so `navigateBack(state,
  'build')` + `markDownstreamStale` already restages it when it is `done`; the explicit
  lines exist only because `wiring_check` itself is `failed` (not `done`) and
  `markDownstreamStale` only restages `done` steps. The set therefore stays
  `{wiring_check, manual_test}` — but this must be **proved by test**, not assumed.

`GATE_SURFACE` is a keyed record and needs no change. `VALIDATION_GROUP` needs no change.

**D4 — In-flight state compatibility is a first-class negative path.** A feature whose
persisted `.pipeline` state was written under the old topology can have
`build_review: 'done'` while `wiring_check` is `pending`. After the swap that is a `done`
step whose prerequisite is unsatisfied. The engine must resume such a feature to a sane
state (re-run `wiring_check`, then re-evaluate `build_review` under its normal freshness
rules) rather than deadlock or skip a gate. No state migration file is introduced — state
keys are unchanged; only the selector's traversal must tolerate the shape.

## Rejected sub-decision: no build-completeness regression allowance

adr-2026-07-21-completeness-as-build-review-rubric makes `build_review` the sole authority on
whether the build is *complete*. Putting `wiring_check` first means an incomplete build can
now be judged by the wiring gate before the completeness gate speaks — producing a
"symbol exported but referenced by no production code" kickback where the true cause is
"the wire-it-in task has not been written yet". We considered making `wiring_check` abstain
when the build looks incomplete; **rejected** — that would require the wiring gate to
re-derive completeness, which the same ADR forbids. The outcome is identical either way (a
kickback to `build`), only the message differs, and both gates' kickback counters are
independent (`kickbackCounts` is keyed per gate, `MAX_KICKBACKS_PER_GATE` applied
per key). Mitigation is a message change only: the wiring kickback hint gains a line telling
`build` that an unfinished wire-in task is a legitimate cause.

## Consequences

- On a wiring-broken HEAD: zero grader dispatch and zero wiring session — the kickback is
  produced by a deterministic probe in seconds. (Outcomes 1 + the un-filed cost.)
- On a wiring-clean HEAD: `build_review` runs exactly once for that HEAD, immediately after
  a free wiring verdict. Progression `build → wiring_check → build_review → manual_test` is
  unchanged in membership and enforcement. (Outcome 2.)
- Rebuild semantics unchanged: a file-changing rebase or a build kickback re-opens both
  gates and both re-evaluate the new HEAD. (Outcome 3.)
- Two APPROVED ADRs' positioning statements are superseded by this one; their Decision
  sections gain a pointer rather than being rewritten.
- **Overlap note:** intake #878 (trailer-scan caching) is concurrently editing
  `conductor.ts` among other files. D1/D3 touch `conductor.ts:3247-3271`, `:4505-4509`, and
  `:5505-5512` — disjoint regions from #878's build-completion/re-kick paths, but the two
  branches will need a textual rebase in `conductor.ts`. Flagged, not coordinated.
