# Conflict Check: Custom build_review rubrics run on every platform without an OS containment boundary

**Date:** 2026-09-24
**Source:** jstoup111/ai-conductor#2735
**Stories checked:** `.docs/stories/custom-build-review-rubrics-cannot-run-off-linux-o.md` (Stories
1–7) against all 487 files in `.docs/stories/`, read in six independent passes.
**ADR corpus:** `repo_wide` (`conflict_check.adr_corpus`). All 320 ADRs were examined earlier in
this DECIDE pass. The corpus narrowed to 16 whose subject overlaps these stories; the other 304
were narrowed out with no subject overlap. No ADR in the narrowed set is fully superseded. ADR
tensions are resolved by the APPROVED amendments recorded in
`architecture-review-2026-09-24-custom-build-review-rubrics-cannot-run-off-linux-o.md`.
**Result:** PASSED after resolution. There were 9 blocking and 5 degrading conflicts; all 14 are
resolved, and none is accepted as a compromise.

Foreign-stem story, plan and ADR replacements cannot land in this spec (the land stem gate). They
travel in the companion main-based branch `docs/2735-companion-amendments`, which merges together
with this spec.

## Blocking

### Conflict 1: Linux-only custom-policy environment

**Stories involved:** projects-cannot-add-portable-non-competing-build-r preamble and Story 10 vs Story 1
**Type:** contradiction · **Severity:** blocking
The #1986 preamble restricts custom-policy support to "Linux with proven read-only containment". Story
10 refuses before judging when containment is unavailable. New Story 1 judges on darwin and on
restricted Linux.
**Resolution:** Option 1. The #1986 preamble, Story 10 and its coverage rows are replaced in place
(companion) to describe read-only review mode availability, refused writes, and whole-lap discard.

### Conflict 2: Private scratch and sibling-evidence withholding

**Stories involved:** projects-cannot-add-portable-non-competing-build-r Story 10 vs Stories 2–4
**Type:** state-conflict · **Severity:** blocking
Story 10 promises a private writable scratch and that a reviewer cannot obtain sibling evidence. New
Stories 2–3 use the ordinary provider home, and adr-2026-09-10 D5.4 makes reads tool-restricted only.
**Resolution:** Option 1. Story 10 is replaced in place (companion): provider state lives in the
ordinary home, writes are refused by read-only mode, and any change discards the lap. The sibling-read
clause is removed, per the operator-approved D5.4.

### Conflict 3: Pi capability names a retired module

**Stories involved:** pi-as-a-build-provider Story 2 (and its plan Task 5, coherence rows, architecture, ADR D2/D6) vs Stories 1–3, 6
**Type:** sequencing · **Severity:** blocking
Pi's Task 5 narrows `build-review-containment.ts`, which this feature retires. Both features also edit
the same step-runners paths.
**Resolution:** Option 3. #1884 is set `blocked_by` #2735. In the companion, the capability is renamed
`readOnlyReview` consistently across Pi's story, plan, coherence and architecture, with an additive
amendment on its ADR, and Task 5 targets the read-only review admission check.

### Conflict 4: Universal workspace-write for unattended Codex

**Stories involved:** codex-auth-sandbox-permission-readiness-905 HP-1 and streaming-provider-dispatches-record-no-token-usag Story 7 vs Story 3
**Type:** contradiction · **Severity:** blocking
Both assert that every unattended Codex invocation carries workspace-write overrides. Story 3 forbids
them for custom-policy lap members.
**Resolution:** Option 1. Both criteria carve out read-only review members in place (companion).

### Conflict 5: Built-in testQuality peers need `git show`

**Stories involved:** build-review-testquality-rubric-prompt-embeds-full Story 3 vs Story 2
**Type:** resource-contention · **Severity:** blocking
testQuality reads evidence with `git show «ref»:«path»`. A Claude peer restricted to Read, Grep and
Glob could not.
**Resolution:** Option 2. Claude's read-only mode enables Bash with allow rules that admit only
read-only git subcommands. Any other Bash command is denied in print mode (verified 2026-09-24).
adr-2026-09-10 D5.2 and Story 2 are revised; the earlier "Claude has no git" refusal is dropped.

### Conflict 6: Native-schema scratch home is the same lease mechanism

**Stories involved:** build-review-rubric-findings-arrive-as-typed-struc Story 2 vs Story 3
**Type:** resource-contention · **Severity:** blocking
The earlier Story 3 said no scratch home is acquired for a Codex member. Codex native-schema dispatch
requires its engine-owned schema scratch home (`nativeSchemaScratchHome`).
**Resolution:** Option 1. Story 3 is revised: the native-schema scratch home remains, is not
`CODEX_HOME`, and no login file is copied.

### Conflict 7: Retriable-cause wording omits the deterministic causes

**Stories involved:** one-rubric-s-rejected-contract-discards-the-whole- Story 2 and review-infrastructure-failures-are-operator-unreco Story 5 vs Story 6
**Type:** contradiction · **Severity:** blocking
Both define retriable as "any closed reason other than `projection-oversized`", which would classify
`read-only-review-unavailable` as retriable.
**Resolution:** Option 1. Both are updated in place (companion) to name the deterministic set:
`projection-oversized`, `native-schema-unsupported`, and `read-only-review-unavailable`.

### Conflict 8: Reduced coverage refused while allowance remains

**Stories involved:** review-infrastructure-failures-are-operator-unreco Story 9 vs Story 6
**Type:** oscillating · **Severity:** blocking
`read-only-review-unavailable` halts before any allowance is spent. The reduced-coverage lever refuses
any rubric with allowance remaining, so the halt would have no operator lever, and clearing the halt
only reproduces it. The code confirms the gap: `build-review-cli.ts` exempts only
`projection-oversized`.
**Resolution:** Option 1. The Story 9 criterion is updated (companion) to accept deterministic causes.
New Story 6 adds the acceptance criterion, and the architecture review adds Condition 4.

### Conflict 9: Self-host bubblewrap vs "zero bubblewrap spawns"

**Stories involved:** live-boundary-guard-cannot-attribute-a-live-checko Story 3 vs Story 1 Done When
**Type:** overlap · **Severity:** blocking
A self-host prepared invocation is itself a bubblewrap wrap, so an unscoped "zero bubblewrap spawns"
could not hold on self-host.
**Resolution:** Option 1. Story 1's Done When is scoped to non-self-host fixtures. Story 2 and Story 7
already keep self-host unchanged.

## Degrading, all resolved

1. **Provider-id-shaped refusal vs the Pi structural test** (pi-as-a-build-provider Story 1). Story 6
   now refuses "a candidate whose provider declares no read-only review mode", by capability rather
   than by name.
2. **Read-only-unavailable plus usage suppression on one member** (usage-exhaustion-re-dispatches-the-exhausted-provi
   Stories 2 and 6). Story 6 adds that each candidate yields exactly one `provider_attempt`, and that a remaining suppressed candidate keeps the existing usage wait
   (adr-2026-09-23 D7) instead of settling `read-only-review-unavailable`.
3. **Rubric-level skip reason "disabled only"** (build-review-rubric-dispositions-and-fan-out Story 5).
   Checked in both directions: that is the rubric skip set, not `provider_attempt.skipReason`. No
   member is skipped by this feature. No change needed.
4. **Lap-wide `review-input-mutated` vs the per-rubric reduced-coverage key**
   (review-infrastructure-failures-are-operator-unreco). Every member branch settles with the cause,
   so each rubric carries `{rubric, review-input-mutated}` (adr-2026-08-18 D7). No change needed.
5. **Feature checkout inside the digest vs "reviewers still observe that lap's captured input"**
   (projects-cannot-add-portable-non-competing-build-r Story 10, negative 3). Resolved before stories
   were accepted: the digest excludes the feature checkout (adr-2026-09-10 D5.3), and Story 4 asserts
   that a checkout change does not discard the lap.

## Overlapping but compatible (checked both directions)

- keep-containment-advisories-out-of-build-review-s- and out-of-plan-production-edits-reach-build-review-in:
  "containment" there means the plan-scope commit boundary. The shared word is a name collision only.
- interrupted-self-host-runs-leak-provider-homes-unt, isolate-daemon-build-auth-from-operator-oauth,
  harness-self-host-guardrails, codex-safety-and-self-host-parity-907: the self-host homes and overlays
  are preserved by Stories 2, 3 and 7.
- unusable-provider-candidate-throws-instead-of-fall, model-availability-fallback-ladder,
  per-step-provider-routing-927: Story 6 reuses the existing `setup-unavailable` candidate skip and
  fallback. It adds no skip reason.
- export-the-telemetry-dimensions-the-engine-already: `invoked:false` rows are already excluded from
  dispatch counts.
- mechanically-enforce-otel-handler-coverage-for-ote, staleness-decisions-invisible-in-daemon-log:
  Story 5's event carries a sink declaration.
- as-built-review-receives-bounded-inputs-and-return: native-schema scratch pattern, unchanged.
- grade-the-diff-for-security-defects-before-ship-vi: the built-in `security` rubric alone does not
  make a lap custom-policy, so Story 7 applies.
- one-build-review-pass-clears-the-convergence-cap-s: mechanical-allowance credit and reset rules are
  compatible with Stories 4 and 6.
